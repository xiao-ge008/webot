import argparse
import json
import os
import re
import sys
import warnings
import wave

warnings.filterwarnings(
    "ignore",
    message="pkg_resources is deprecated as an API.*",
    category=UserWarning,
)

try:
    import jieba
    import numpy as np
    import onnxruntime as ort
    from pypinyin import Style, lazy_pinyin
except ModuleNotFoundError as exc:
    missing = exc.name or "unknown"
    raise SystemExit(
        "本地 F5-TTS Python 依赖缺失，请安装: "
        "pip install numpy onnxruntime jieba pypinyin"
        f"；当前缺少: {missing}"
    )


MODEL_SAMPLE_RATE = 24000
HOP_LENGTH = 256
RANDOM_SEED = 9527
NFE_STEP = 32
FUSE_NFE = 1
ZH_PAUSE_PUNC = r"。，、；：？！"


def load_request(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def ensure_file(path: str, label: str) -> str:
    normalized = os.path.abspath(path)
    if not os.path.isfile(normalized):
        raise ValueError(f"{label}不存在: {normalized}")
    return normalized


def ensure_dir(path: str, label: str) -> str:
    normalized = os.path.abspath(path)
    if not os.path.isdir(normalized):
        raise ValueError(f"{label}不存在: {normalized}")
    return normalized


def load_vocab(path: str) -> dict:
    vocab = {}
    with open(path, "r", encoding="utf-8") as handle:
        for index, line in enumerate(handle):
            token = line.rstrip("\r\n")
            vocab[token] = index
    if not vocab:
        raise ValueError(f"词表为空: {path}")
    return vocab


def read_wav_mono_pcm(path: str, target_sample_rate: int) -> np.ndarray:
    with wave.open(path, "rb") as wav_file:
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        sample_rate = wav_file.getframerate()
        frame_count = wav_file.getnframes()
        raw = wav_file.readframes(frame_count)

    if sample_width == 1:
        audio = np.frombuffer(raw, dtype=np.uint8).astype(np.float32)
        audio = (audio - 128.0) / 128.0
    elif sample_width == 2:
        audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    elif sample_width == 4:
        audio = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"当前仅支持 8/16/32bit PCM WAV，检测到 {sample_width * 8}bit")

    if channels > 1:
        audio = audio.reshape(-1, channels).mean(axis=1)

    if sample_rate != target_sample_rate:
        audio = resample_linear(audio, sample_rate, target_sample_rate)

    audio = trim_silence(audio)
    if audio.size == 0:
        raise ValueError("参考音频静音过多，裁剪后为空")
    return np.clip(audio, -1.0, 1.0)


def resample_linear(audio: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    if source_rate == target_rate or audio.size == 0:
        return audio.astype(np.float32, copy=False)

    duration = audio.shape[0] / float(source_rate)
    target_length = max(1, int(round(duration * target_rate)))
    source_positions = np.linspace(0.0, max(audio.shape[0] - 1, 0), num=audio.shape[0], dtype=np.float32)
    target_positions = np.linspace(0.0, max(audio.shape[0] - 1, 0), num=target_length, dtype=np.float32)
    resampled = np.interp(target_positions, source_positions, audio).astype(np.float32)
    return resampled


def trim_silence(audio: np.ndarray, threshold: float = 0.01) -> np.ndarray:
    mask = np.where(np.abs(audio) > threshold)[0]
    if mask.size == 0:
        return audio
    start = max(0, int(mask[0]) - 256)
    end = min(audio.shape[0], int(mask[-1]) + 256)
    return audio[start:end]


def convert_char_to_pinyin(text_list, polyphone=True):
    if jieba.dt.initialized is False:
        jieba.default_logger.setLevel(50)
        jieba.initialize()

    final_text_list = []
    custom_trans = str.maketrans({
        ";": ",",
        "“": '"',
        "”": '"',
        "‘": "'",
        "’": "'",
    })

    def is_chinese(char):
        return "\u3100" <= char <= "\u9fff"

    for text in text_list:
        char_list = []
        text = text.translate(custom_trans)
        for seg in jieba.cut(text):
            seg_byte_len = len(seg.encode("utf-8"))
            if seg_byte_len == len(seg):
                if char_list and seg_byte_len > 1 and char_list[-1] not in " :'\",":
                    char_list.append(" ")
                char_list.extend(seg)
            elif polyphone and seg_byte_len == 3 * len(seg):
                seg_ = lazy_pinyin(seg, style=Style.TONE3, tone_sandhi=True)
                for idx, char in enumerate(seg):
                    if is_chinese(char):
                        char_list.append(" ")
                        char_list.append(seg_[idx])
                    else:
                        char_list.append(char)
            else:
                for char in seg:
                    if ord(char) < 256:
                        char_list.extend(char)
                    elif is_chinese(char):
                        char_list.append(" ")
                        char_list.extend(lazy_pinyin(char, style=Style.TONE3, tone_sandhi=True))
                    else:
                        char_list.append(char)
        final_text_list.append(char_list)
    return final_text_list


def list_str_to_idx(texts, vocab_char_map, padding_value=-1):
    rows = []
    max_len = 0
    for text in texts:
        row = [vocab_char_map.get(char, 0) for char in text]
        rows.append(row)
        max_len = max(max_len, len(row))
    if max_len == 0:
        return np.zeros((len(rows), 1), dtype=np.int32)

    output = np.full((len(rows), max_len), padding_value, dtype=np.int32)
    for row_idx, row in enumerate(rows):
        if row:
            output[row_idx, :len(row)] = np.asarray(row, dtype=np.int32)
    return output


def choose_transformer_providers(device: str) -> list[str]:
    available = ort.get_available_providers()
    normalized = (device or "auto").strip().lower()
    if normalized == "cpu":
        return ["CPUExecutionProvider"]
    if normalized == "directml":
        if "DmlExecutionProvider" not in available:
            raise ValueError("当前环境未安装 onnxruntime-directml，无法使用 DirectML")
        return ["DmlExecutionProvider"]
    if normalized == "openvino":
        if "OpenVINOExecutionProvider" not in available:
            raise ValueError("当前环境未安装 OpenVINO Execution Provider")
        return ["OpenVINOExecutionProvider"]
    if "DmlExecutionProvider" in available:
        return ["DmlExecutionProvider"]
    if "OpenVINOExecutionProvider" in available:
        return ["OpenVINOExecutionProvider"]
    return ["CPUExecutionProvider"]


def create_session_options() -> ort.SessionOptions:
    ort.set_seed(RANDOM_SEED)
    session_opts = ort.SessionOptions()
    session_opts.log_severity_level = 4
    session_opts.log_verbosity_level = 4
    session_opts.enable_cpu_mem_arena = True
    session_opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    session_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    session_opts.add_session_config_entry("session.set_denormal_as_zero", "1")
    session_opts.add_session_config_entry("session.intra_op.allow_spinning", "1")
    session_opts.add_session_config_entry("session.inter_op.allow_spinning", "1")
    return session_opts


def create_sessions(model_dir: str, transformer_providers: list[str]):
    session_opts = create_session_options()
    preprocess = ort.InferenceSession(
        os.path.join(model_dir, "F5_Preprocess.onnx"),
        sess_options=session_opts,
        providers=["CPUExecutionProvider"],
    )

    transformer = ort.InferenceSession(
        os.path.join(model_dir, "F5_Transformer.onnx"),
        sess_options=session_opts,
        providers=transformer_providers,
    )

    decode = ort.InferenceSession(
        os.path.join(model_dir, "F5_Decode.onnx"),
        sess_options=session_opts,
        providers=["CPUExecutionProvider"],
    )
    return preprocess, transformer, decode


def pcm16_from_float(audio: np.ndarray) -> np.ndarray:
    clipped = np.clip(audio, -1.0, 1.0)
    return (clipped * 32767.0).astype(np.int16)


def float_from_pcm16(audio: np.ndarray) -> np.ndarray:
    return (audio.astype(np.float32) / 32768.0).clip(-1.0, 1.0)


def write_wav(path: str, audio: np.ndarray, sample_rate: int) -> None:
    pcm = pcm16_from_float(audio.reshape(-1))
    with wave.open(path, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm.tobytes())


def synthesize_chunk(
    preprocess_session,
    transformer_session,
    decode_session,
    reference_audio: np.ndarray,
    reference_text: str,
    chunk_text: str,
    vocab_char_map: dict,
    speed: float,
) -> np.ndarray:
    ref_text_len = len(reference_text.encode("utf-8")) + 3 * len(re.findall(ZH_PAUSE_PUNC, reference_text))
    gen_text_len = len(chunk_text.encode("utf-8")) + 3 * len(re.findall(ZH_PAUSE_PUNC, chunk_text))
    ref_audio_len = reference_audio.shape[-1] // HOP_LENGTH + 1
    max_duration = np.array(
        [ref_audio_len + int(ref_audio_len / max(ref_text_len, 1) * max(gen_text_len, 1) / max(speed, 0.1))],
        dtype=np.int64,
    )
    text_ids = list_str_to_idx(convert_char_to_pinyin([reference_text + chunk_text]), vocab_char_map)
    preprocess_outputs = preprocess_session.run(
        None,
        {
            preprocess_session.get_inputs()[0].name: reference_audio,
            preprocess_session.get_inputs()[1].name: text_ids,
            preprocess_session.get_inputs()[2].name: max_duration,
        },
    )
    noise = preprocess_outputs[0]
    time_step = np.array([0], dtype=np.int32)

    transformer_input_names = [item.name for item in transformer_session.get_inputs()]
    transformer_output_names = [item.name for item in transformer_session.get_outputs()]
    for _ in range(0, NFE_STEP - 1, FUSE_NFE):
        noise, time_step = transformer_session.run(
            transformer_output_names[:2],
            {
                transformer_input_names[0]: noise,
                transformer_input_names[1]: preprocess_outputs[1],
                transformer_input_names[2]: preprocess_outputs[2],
                transformer_input_names[3]: preprocess_outputs[3],
                transformer_input_names[4]: preprocess_outputs[4],
                transformer_input_names[5]: preprocess_outputs[5],
                transformer_input_names[6]: preprocess_outputs[6],
                transformer_input_names[7]: time_step,
            },
        )

    decode_output = decode_session.run(
        None,
        {
            decode_session.get_inputs()[0].name: noise,
            decode_session.get_inputs()[1].name: preprocess_outputs[7],
        },
    )[0]
    return float_from_pcm16(decode_output.reshape(-1))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    args = parser.parse_args()

    request = load_request(args.request)
    model_dir = ensure_dir(request.get("modelDir", ""), "模型目录")
    ref_audio_path = ensure_file(request.get("refAudioPath", ""), "参考音频")
    ref_text = str(request.get("refText", "")).strip()
    texts = [str(item).strip() for item in request.get("texts", []) if str(item).strip()]
    speed = float(request.get("speed", 1.0) or 1.0)
    device = str(request.get("device", "auto") or "auto").strip().lower()
    output_path = os.path.abspath(str(request.get("outputPath", "")).strip())

    if not ref_text:
        raise ValueError("参考文本不能为空")
    if not texts:
        raise ValueError("待合成文本不能为空")
    if not output_path:
        raise ValueError("输出路径不能为空")

    vocab_path = ensure_file(os.path.join(model_dir, "vocab.txt"), "词表")
    vocab_char_map = load_vocab(vocab_path)

    reference_audio = read_wav_mono_pcm(ref_audio_path, MODEL_SAMPLE_RATE)
    reference_audio = pcm16_from_float(reference_audio).reshape(1, 1, -1)

    transformer_providers = choose_transformer_providers(device)
    preprocess_session, transformer_session, decode_session = create_sessions(model_dir, transformer_providers)

    generated_segments = []
    silence = np.zeros(int(MODEL_SAMPLE_RATE * 0.10), dtype=np.float32)
    for index, chunk_text in enumerate(texts):
        chunk_audio = synthesize_chunk(
            preprocess_session,
            transformer_session,
            decode_session,
            reference_audio,
            ref_text,
            chunk_text,
            vocab_char_map,
            speed,
        )
        if chunk_audio.size == 0:
            continue
        generated_segments.append(chunk_audio)
        if index < len(texts) - 1:
            generated_segments.append(silence)

    if not generated_segments:
        raise ValueError("模型未生成有效音频")

    generated_audio = np.concatenate(generated_segments).astype(np.float32)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    write_wav(output_path, generated_audio, MODEL_SAMPLE_RATE)

    payload = {
        "outputPath": output_path,
        "sampleRate": MODEL_SAMPLE_RATE,
        "durationSecs": round(float(generated_audio.shape[0]) / float(MODEL_SAMPLE_RATE), 4),
        "chunks": len(texts),
        "provider": "local",
        "engine": "f5-tts-onnx",
        "device": transformer_providers[0],
        "warnings": [],
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        sys.stderr.write(str(exc))
        raise SystemExit(1)
