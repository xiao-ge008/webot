//! Streaming think-tag filter.
//!
//! Some LLMs embed `<think>...</think>` reasoning blocks in streamed content
//! deltas. This filter keeps visible text and thinking text separated even when
//! tags are split across multiple chunks.

#[derive(Debug, Clone, PartialEq)]
pub enum FilterAction {
    EmitText(String),
    EmitThinking(String),
}

pub struct StreamingThinkFilter {
    inside_think: bool,
    pending: String,
}

impl StreamingThinkFilter {
    pub fn new() -> Self {
        Self {
            inside_think: false,
            pending: String::new(),
        }
    }

    pub fn is_inside_think(&self) -> bool {
        self.inside_think
    }

    pub fn process(&mut self, delta: &str) -> Vec<FilterAction> {
        self.pending.push_str(delta);
        let mut actions = Vec::new();

        loop {
            if self.inside_think {
                if let Some(end_pos) = self.pending.find("</think>") {
                    let thinking = self.pending[..end_pos].to_string();
                    if !thinking.is_empty() {
                        actions.push(FilterAction::EmitThinking(thinking));
                    }
                    self.pending = self.pending[end_pos + "</think>".len()..].to_string();
                    self.inside_think = false;
                    continue;
                }

                let keep = partial_suffix_match(&self.pending, "</think>");
                let emit_len = self.pending.len() - keep;
                if emit_len > 0 {
                    let thinking = self.pending[..emit_len].to_string();
                    if !thinking.is_empty() {
                        actions.push(FilterAction::EmitThinking(thinking));
                    }
                    self.pending = self.pending[emit_len..].to_string();
                }
                break;
            } else {
                if let Some(start_pos) = self.pending.find("<think>") {
                    let visible = self.pending[..start_pos].to_string();
                    if !visible.is_empty() {
                        actions.push(FilterAction::EmitText(visible));
                    }
                    self.pending = self.pending[start_pos + "<think>".len()..].to_string();
                    self.inside_think = true;
                    continue;
                }

                let keep = partial_suffix_match(&self.pending, "<think>");
                let emit_len = self.pending.len() - keep;
                if emit_len > 0 {
                    let visible = self.pending[..emit_len].to_string();
                    if !visible.is_empty() {
                        actions.push(FilterAction::EmitText(visible));
                    }
                    self.pending = self.pending[emit_len..].to_string();
                }
                break;
            }
        }

        actions
    }

    pub fn flush(&mut self) -> Vec<FilterAction> {
        let mut actions = Vec::new();
        if !self.pending.is_empty() {
            let text = std::mem::take(&mut self.pending);
            if self.inside_think {
                actions.push(FilterAction::EmitThinking(text));
            } else {
                actions.push(FilterAction::EmitText(text));
            }
        }
        actions
    }
}

impl Default for StreamingThinkFilter {
    fn default() -> Self {
        Self::new()
    }
}

fn partial_suffix_match(haystack: &str, needle: &str) -> usize {
    let h = haystack.as_bytes();
    let n = needle.as_bytes();
    let max_len = h.len().min(n.len() - 1);
    for len in (1..=max_len).rev() {
        if h.ends_with(&n[..len]) {
            return len;
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_complete_block() {
        let mut filter = StreamingThinkFilter::new();
        let actions = filter.process("<think>inner</think>outer");
        assert_eq!(
            actions,
            vec![
                FilterAction::EmitThinking("inner".into()),
                FilterAction::EmitText("outer".into()),
            ]
        );
    }

    #[test]
    fn filters_partial_tags_across_chunks() {
        let mut filter = StreamingThinkFilter::new();
        assert_eq!(
            filter.process("hello <thi"),
            vec![FilterAction::EmitText("hello ".into())]
        );
        assert_eq!(
            filter.process("nk>reason"),
            vec![FilterAction::EmitThinking("reason".into())]
        );
        assert_eq!(
            filter.process("</think> world"),
            vec![FilterAction::EmitText(" world".into())]
        );
        assert!(!filter.is_inside_think());
    }
}
