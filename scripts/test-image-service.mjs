import { mkdir, readFile, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serviceBaseUrl =
  process.env.WEBOT_IMAGE_SERVICE_BASE_URL ?? "http://127.0.0.1:4310";
const webotHome = process.env.WEBOT_HOME ?? path.join(os.homedir(), ".webot");
const configPath = path.join(webotHome, "image-generation.json");
const workspaceRoot = path.join(webotHome, "workspaces", "image-service-smoke-test");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const serviceManifest = path.join(repoRoot, "apps", "service-rs", "Cargo.toml");

async function readJson(filePath) {
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}\n${text}`);
  }
  return payload;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function isServiceHealthy() {
  try {
    const response = await fetch(`${serviceBaseUrl}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function startManagedService() {
  const child = spawn("cargo", ["run", "--manifest-path", serviceManifest], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    windowsHide: true,
  });

  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});

  for (let index = 0; index < 90; index += 1) {
    if (child.exitCode !== null) {
      throw new Error(`service-rs 启动失败，退出码: ${child.exitCode}`);
    }
    if (await isServiceHealthy()) {
      return child;
    }
    await sleep(500);
  }

  child.kill("SIGTERM");
  throw new Error("service-rs 未在预期时间内启动成功");
}

async function ensureServiceRunning() {
  if (await isServiceHealthy()) {
    return null;
  }

  console.log("本地图片服务未运行，正在临时启动 service-rs ...");
  return startManagedService();
}

function stopManagedService(child) {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
  }
}

function resolveGenerateShape(config) {
  const generate = config?.comfyui?.generate ?? {};
  const width = Number(generate.defaultWidth ?? config?.comfyui?.defaultWidth ?? 1024);
  const height = Number(generate.defaultHeight ?? config?.comfyui?.defaultHeight ?? 1024);
  return {
    width,
    height,
    size: `${width}x${height}`,
  };
}

function ensureHandled(payload, label) {
  if (!payload || payload.handled !== true || !payload.response) {
    throw new Error(`${label} 未被统一图片服务处理:\n${JSON.stringify(payload, null, 2)}`);
  }
  return payload.response;
}

async function main() {
  await access(configPath);
  const config = await readJson(configPath);
  const shape = resolveGenerateShape(config);
  await mkdir(workspaceRoot, { recursive: true });
  let serviceProcess = await ensureServiceRunning();

  try {
    const generatePayload = {
      prompt: "一只坐在木桌上的橘猫，柔和摄影棚灯光，写实风格，高细节",
      negativePrompt: "low quality, blurry, watermark, text",
      width: shape.width,
      height: shape.height,
      size: shape.size,
      quality: "standard",
      count: 1,
      workspaceRoot,
    };

    console.log(`[1/2] 生成图片 -> ${serviceBaseUrl}/api/management/image-generation/generate`);
    const generateEnvelope = await postJson(
      `${serviceBaseUrl}/api/management/image-generation/generate`,
      generatePayload,
    );
    const generateResult = ensureHandled(generateEnvelope, "生成图片");
    console.log(JSON.stringify(generateResult, null, 2));

    const sourceImageUrl = generateResult.image_urls?.[0];
    if (!sourceImageUrl) {
      throw new Error("生成结果未返回 image_urls[0]");
    }

    if (serviceProcess) {
      console.log("重启 service-rs，验证 /api/uploads 原图在重启后仍可用于改图 ...");
      stopManagedService(serviceProcess);
      await sleep(1500);
      serviceProcess = await startManagedService();
    }

    const editPayload = {
      prompt:
        "保持同一只橘猫、同一构图、同一风格和同一光线不变，只给它加一个红色蝴蝶结，其他部分全部保持不变",
      negativePrompt: "low quality, blurry, watermark, text",
      imageUrl: sourceImageUrl,
      width: shape.width,
      height: shape.height,
      size: shape.size,
      quality: "standard",
      count: 1,
      workspaceRoot,
    };

    console.log(`[2/2] 修改图片 -> ${serviceBaseUrl}/api/management/image-generation/edit`);
    const editEnvelope = await postJson(
      `${serviceBaseUrl}/api/management/image-generation/edit`,
      editPayload,
    );
    const editResult = ensureHandled(editEnvelope, "修改图片");
    console.log(JSON.stringify(editResult, null, 2));

    console.log("\nSmoke test 完成。");
    console.log(`生成图: ${generateResult.saved_to?.[0] ?? "<none>"}`);
    console.log(`改图: ${editResult.saved_to?.[0] ?? "<none>"}`);
  } finally {
    stopManagedService(serviceProcess);
  }
}

main().catch((error) => {
  console.error("图片服务测试失败:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
