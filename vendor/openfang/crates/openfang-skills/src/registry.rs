//! Skill registry — tracks installed skills and their tools.

use crate::bundled;
use crate::openclaw_compat;
use crate::verify::SkillVerifier;
use crate::{InstalledSkill, SkillError, SkillManifest, SkillToolDef};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tracing::{info, warn};

/// Registry of installed skills.
#[derive(Debug, Default)]
pub struct SkillRegistry {
    /// Installed skills keyed by name.
    skills: HashMap<String, InstalledSkill>,
    /// Skills directory.
    skills_dir: PathBuf,
    /// When true, no new skills can be loaded (Stable mode).
    frozen: bool,
}

impl SkillRegistry {
    /// Create a new registry rooted at the given skills directory.
    pub fn new(skills_dir: PathBuf) -> Self {
        Self {
            skills: HashMap::new(),
            skills_dir,
            frozen: false,
        }
    }

    /// Create a cheap owned snapshot of this registry.
    ///
    /// Used to avoid holding `RwLockReadGuard` across `.await` points
    /// (the guard is `!Send`).
    pub fn snapshot(&self) -> SkillRegistry {
        SkillRegistry {
            skills: self.skills.clone(),
            skills_dir: self.skills_dir.clone(),
            frozen: self.frozen,
        }
    }

    /// Freeze the registry, preventing any new skills from being loaded.
    /// Used in Stable mode after initial boot.
    pub fn freeze(&mut self) {
        self.frozen = true;
        info!("Skill registry frozen — no new skills will be loaded");
    }

    /// Check if the registry is frozen.
    pub fn is_frozen(&self) -> bool {
        self.frozen
    }

    /// Load all bundled skills (compile-time embedded SKILL.md files).
    ///
    /// Called before `load_all()` so that user-installed skills with the same name
    /// can override bundled ones. Runs prompt injection scan even on bundled skills
    /// as a defense-in-depth measure.
    pub fn load_bundled(&mut self) -> usize {
        let bundled = bundled::bundled_skills();
        let mut count = 0;

        for (name, content) in &bundled {
            match bundled::parse_bundled(name, content) {
                Ok(manifest) => {
                    // Defense in depth: scan even bundled skill prompt content
                    if let Some(ref ctx) = manifest.prompt_context {
                        let warnings = SkillVerifier::scan_prompt_content(ctx);
                        let has_critical = warnings.iter().any(|w| {
                            matches!(w.severity, crate::verify::WarningSeverity::Critical)
                        });
                        if has_critical {
                            warn!(
                                skill = %manifest.skill.name,
                                "BLOCKED bundled skill: critical prompt injection patterns"
                            );
                            continue;
                        }
                    }

                    self.skills.insert(
                        manifest.skill.name.clone(),
                        InstalledSkill {
                            manifest,
                            path: PathBuf::from("<bundled>"),
                            enabled: true,
                        },
                    );
                    count += 1;
                }
                Err(e) => {
                    warn!("Failed to parse bundled skill '{name}': {e}");
                }
            }
        }

        if count > 0 {
            info!("Loaded {count} bundled skill(s)");
        }
        count
    }

    /// Load all installed skills from the skills directory.
    pub fn load_all(&mut self) -> Result<usize, SkillError> {
        if !self.skills_dir.exists() {
            return Ok(0);
        }

        let mut count = 0;
        let entries = std::fs::read_dir(&self.skills_dir)?;

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let manifest_path = path.join("skill.toml");
            if !manifest_path.exists() {
                // Auto-detect SKILL.md and convert to skill.toml + prompt_context.md
                if openclaw_compat::detect_skillmd(&path) {
                    match openclaw_compat::convert_skillmd(&path) {
                        Ok(converted) => {
                            // SECURITY: Scan prompt content for injection attacks
                            // before accepting the skill. 341 malicious skills were
                            // found on ClawHub — block critical threats at load time.
                            let warnings =
                                SkillVerifier::scan_prompt_content(&converted.prompt_context);
                            let has_critical = warnings.iter().any(|w| {
                                matches!(w.severity, crate::verify::WarningSeverity::Critical)
                            });
                            if has_critical {
                                warn!(
                                    skill = %converted.manifest.skill.name,
                                    "BLOCKED: SKILL.md contains critical prompt injection patterns"
                                );
                                for w in &warnings {
                                    warn!("  [{:?}] {}", w.severity, w.message);
                                }
                                continue;
                            }
                            if !warnings.is_empty() {
                                for w in &warnings {
                                    warn!(
                                        skill = %converted.manifest.skill.name,
                                        "[{:?}] {}",
                                        w.severity,
                                        w.message
                                    );
                                }
                            }

                            info!(
                                skill = %converted.manifest.skill.name,
                                "Auto-converting SKILL.md to OpenFang format"
                            );
                            if let Err(e) =
                                openclaw_compat::write_openfang_manifest(&path, &converted.manifest)
                            {
                                warn!("Failed to write skill.toml for {}: {e}", path.display());
                                continue;
                            }
                            if let Err(e) = openclaw_compat::write_prompt_context(
                                &path,
                                &converted.prompt_context,
                            ) {
                                warn!(
                                    "Failed to write prompt_context.md for {}: {e}",
                                    path.display()
                                );
                            }
                            // Fall through to load the newly written skill.toml
                        }
                        Err(e) => {
                            warn!("Failed to convert SKILL.md at {}: {e}", path.display());
                            continue;
                        }
                    }
                } else {
                    continue;
                }
            }

            match self.load_skill(&path) {
                Ok(_) => count += 1,
                Err(e) => {
                    warn!("Failed to load skill at {}: {e}", path.display());
                }
            }
        }

        info!("Loaded {count} skills from {}", self.skills_dir.display());
        Ok(count)
    }

    /// Load a single skill from a directory.
    pub fn load_skill(&mut self, skill_dir: &Path) -> Result<String, SkillError> {
        if self.frozen {
            return Err(SkillError::NotFound(
                "Skill registry is frozen (Stable mode)".to_string(),
            ));
        }
        let manifest_path = skill_dir.join("skill.toml");
        let toml_str = std::fs::read_to_string(&manifest_path)?;
        let manifest: SkillManifest = toml::from_str(&toml_str)?;

        let name = manifest.skill.name.clone();

        self.skills.insert(
            name.clone(),
            InstalledSkill {
                manifest,
                path: skill_dir.to_path_buf(),
                enabled: true,
            },
        );

        info!("Loaded skill: {name}");
        Ok(name)
    }

    /// Get an installed skill by name.
    pub fn get(&self, name: &str) -> Option<&InstalledSkill> {
        self.skills.get(name)
    }

    /// List all installed skills.
    pub fn list(&self) -> Vec<&InstalledSkill> {
        self.skills.values().collect()
    }

    /// Remove a skill by name.
    pub fn remove(&mut self, name: &str) -> Result<(), SkillError> {
        let skill = self
            .skills
            .remove(name)
            .ok_or_else(|| SkillError::NotFound(name.to_string()))?;

        // Remove the skill directory
        if skill.path.exists() {
            std::fs::remove_dir_all(&skill.path)?;
        }

        info!("Removed skill: {name}");
        Ok(())
    }

    /// Get all tool definitions from all enabled skills.
    pub fn all_tool_definitions(&self) -> Vec<SkillToolDef> {
        self.skills
            .values()
            .filter(|s| s.enabled)
            .flat_map(|s| s.manifest.tools.provided.iter().cloned())
            .collect()
    }

    /// Get tool definitions visible to an agent under its skill allowlist.
    ///
    /// When the allowlist is empty, component-center skills stay hidden so they
    /// must be explicitly attached to the target agent.
    pub fn tool_definitions_for_agent_skills(&self, names: &[String]) -> Vec<SkillToolDef> {
        self.visible_skills_for_agent(names)
            .into_iter()
            .flat_map(|skill| skill.manifest.tools.provided.iter().cloned())
            .collect()
    }

    /// Get tool definitions only from the named skills.
    pub fn tool_definitions_for_skills(&self, names: &[String]) -> Vec<SkillToolDef> {
        self.skills
            .values()
            .filter(|s| s.enabled && names.contains(&s.manifest.skill.name))
            .flat_map(|s| s.manifest.tools.provided.iter().cloned())
            .collect()
    }

    /// List skills visible to an agent under its skill allowlist.
    pub fn visible_skills_for_agent(&self, names: &[String]) -> Vec<&InstalledSkill> {
        self.skills
            .values()
            .filter(|skill| skill_visible_for_agent(skill, names))
            .collect()
    }

    /// Return all installed skill names.
    pub fn skill_names(&self) -> Vec<String> {
        self.skills.keys().cloned().collect()
    }

    /// Find which skill provides a given tool name.
    pub fn find_tool_provider(&self, tool_name: &str) -> Option<&InstalledSkill> {
        self.skills.values().find(|s| {
            s.enabled
                && s.manifest
                    .tools
                    .provided
                    .iter()
                    .any(|t| t.name == tool_name)
        })
    }

    /// Find which visible skill for an agent provides a given tool name.
    pub fn find_tool_provider_for_agent_skills(
        &self,
        tool_name: &str,
        names: &[String],
    ) -> Option<&InstalledSkill> {
        self.skills.values().find(|skill| {
            skill_visible_for_agent(skill, names)
                && skill
                    .manifest
                    .tools
                    .provided
                    .iter()
                    .any(|tool| tool.name == tool_name)
        })
    }

    /// Find all enabled skills carrying the specified tag.
    pub fn find_skills_by_tag(&self, tag: &str) -> Vec<&InstalledSkill> {
        self.skills
            .values()
            .filter(|skill| skill.enabled && skill_has_tag(skill, tag))
            .collect()
    }

    /// Find all enabled skills carrying any of the specified tags.
    pub fn find_skills_by_any_tag(&self, tags: &[&str]) -> Vec<&InstalledSkill> {
        self.skills
            .values()
            .filter(|skill| {
                skill.enabled
                    && tags
                        .iter()
                        .any(|tag| !tag.trim().is_empty() && skill_has_tag(skill, tag))
            })
            .collect()
    }

    /// Find all enabled component-center skills.
    pub fn find_component_skills(&self) -> Vec<&InstalledSkill> {
        self.find_skills_by_tag("component-center")
    }

    /// Find enabled component-center skills by capability tag.
    ///
    /// Accepts either `generate-image` or `capability:generate-image`.
    pub fn find_component_skills_by_capability(&self, capability: &str) -> Vec<&InstalledSkill> {
        let capability_tag = normalize_capability_tag(capability);
        if capability_tag.is_empty() {
            return Vec::new();
        }

        self.skills
            .values()
            .filter(|skill| {
                skill.enabled
                    && skill_has_tag(skill, "component-center")
                    && skill_has_tag(skill, &capability_tag)
            })
            .collect()
    }

    /// Count installed skills.
    pub fn count(&self) -> usize {
        self.skills.len()
    }

    /// Load workspace-scoped skills that override global/bundled skills.
    ///
    /// Scans subdirectories of `workspace_skills_dir` using the same loading
    /// logic as `load_all()`: auto-converts SKILL.md, runs prompt injection
    /// scan, blocks critical threats. Skills loaded here override global ones
    /// with the same name (insert semantics).
    pub fn load_workspace_skills(
        &mut self,
        workspace_skills_dir: &Path,
    ) -> Result<usize, SkillError> {
        if !workspace_skills_dir.exists() {
            return Ok(0);
        }
        if self.frozen {
            return Err(SkillError::NotFound(
                "Skill registry is frozen (Stable mode)".to_string(),
            ));
        }

        let mut count = 0;
        let entries = std::fs::read_dir(workspace_skills_dir)?;

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let manifest_path = path.join("skill.toml");
            if !manifest_path.exists() {
                // Auto-detect SKILL.md and convert
                if openclaw_compat::detect_skillmd(&path) {
                    match openclaw_compat::convert_skillmd(&path) {
                        Ok(converted) => {
                            let warnings =
                                SkillVerifier::scan_prompt_content(&converted.prompt_context);
                            let has_critical = warnings.iter().any(|w| {
                                matches!(w.severity, crate::verify::WarningSeverity::Critical)
                            });
                            if has_critical {
                                warn!(
                                    skill = %converted.manifest.skill.name,
                                    "BLOCKED workspace skill: critical prompt injection patterns"
                                );
                                continue;
                            }

                            if let Err(e) =
                                openclaw_compat::write_openfang_manifest(&path, &converted.manifest)
                            {
                                warn!("Failed to write skill.toml for {}: {e}", path.display());
                                continue;
                            }
                            if let Err(e) = openclaw_compat::write_prompt_context(
                                &path,
                                &converted.prompt_context,
                            ) {
                                warn!(
                                    "Failed to write prompt_context.md for {}: {e}",
                                    path.display()
                                );
                            }
                        }
                        Err(e) => {
                            warn!(
                                "Failed to convert workspace SKILL.md at {}: {e}",
                                path.display()
                            );
                            continue;
                        }
                    }
                } else {
                    continue;
                }
            }

            match self.load_skill(&path) {
                Ok(name) => {
                    info!("Loaded workspace skill: {name}");
                    count += 1;
                }
                Err(e) => {
                    warn!("Failed to load workspace skill at {}: {e}", path.display());
                }
            }
        }

        if count > 0 {
            info!(
                "Loaded {count} workspace skill(s) from {}",
                workspace_skills_dir.display()
            );
        }
        Ok(count)
    }
}

fn skill_has_tag(skill: &InstalledSkill, tag: &str) -> bool {
    let expected = tag.trim();
    !expected.is_empty()
        && skill
            .manifest
            .skill
            .tags
            .iter()
            .any(|item| item.trim().eq_ignore_ascii_case(expected))
}

fn is_component_skill(skill: &InstalledSkill) -> bool {
    skill_has_tag(skill, "component-center") || skill_has_tag(skill, "component-skill")
}

fn skill_visible_for_agent(skill: &InstalledSkill, names: &[String]) -> bool {
    if !skill.enabled {
        return false;
    }

    if names.is_empty() {
        !is_component_skill(skill)
    } else {
        names.contains(&skill.manifest.skill.name)
    }
}

fn normalize_capability_tag(capability: &str) -> String {
    let trimmed = capability.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    const PREFIX: &str = "capability:";
    if trimmed.len() >= PREFIX.len() && trimmed[..PREFIX.len()].eq_ignore_ascii_case(PREFIX) {
        format!(
            "{PREFIX}{}",
            trimmed[PREFIX.len()..].trim().to_ascii_lowercase()
        )
    } else {
        format!("{PREFIX}{}", trimmed.to_ascii_lowercase())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_skill(dir: &Path, name: &str) {
        create_test_skill_with_tags(dir, name, &[]);
    }

    fn create_test_skill_with_tags(dir: &Path, name: &str, tags: &[&str]) {
        let skill_dir = dir.join(name);
        std::fs::create_dir_all(&skill_dir).unwrap();
        let tags_literal = if tags.is_empty() {
            String::new()
        } else {
            format!(
                "tags = [{}]\n",
                tags.iter()
                    .map(|tag| format!("\"{tag}\""))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        };
        std::fs::write(
            skill_dir.join("skill.toml"),
            format!(
                r#"
[skill]
name = "{name}"
version = "0.1.0"
description = "Test skill"
{tags_literal}

[runtime]
type = "python"
entry = "main.py"

[[tools.provided]]
name = "{name}_tool"
description = "A test tool"
input_schema = {{ type = "object" }}
"#,
                tags_literal = tags_literal
            ),
        )
        .unwrap();
    }

    #[test]
    fn test_load_all() {
        let dir = TempDir::new().unwrap();
        create_test_skill(dir.path(), "skill-a");
        create_test_skill(dir.path(), "skill-b");

        let mut registry = SkillRegistry::new(dir.path().to_path_buf());
        let count = registry.load_all().unwrap();
        assert_eq!(count, 2);
        assert_eq!(registry.count(), 2);
    }

    #[test]
    fn test_get_skill() {
        let dir = TempDir::new().unwrap();
        create_test_skill(dir.path(), "my-skill");

        let mut registry = SkillRegistry::new(dir.path().to_path_buf());
        registry.load_all().unwrap();

        let skill = registry.get("my-skill");
        assert!(skill.is_some());
        assert_eq!(skill.unwrap().manifest.skill.name, "my-skill");
    }

    #[test]
    fn test_tool_definitions() {
        let dir = TempDir::new().unwrap();
        create_test_skill(dir.path(), "alpha");
        create_test_skill(dir.path(), "beta");

        let mut registry = SkillRegistry::new(dir.path().to_path_buf());
        registry.load_all().unwrap();

        let tools = registry.all_tool_definitions();
        assert_eq!(tools.len(), 2);
    }

    #[test]
    fn test_find_tool_provider() {
        let dir = TempDir::new().unwrap();
        create_test_skill(dir.path(), "finder");

        let mut registry = SkillRegistry::new(dir.path().to_path_buf());
        registry.load_all().unwrap();

        assert!(registry.find_tool_provider("finder_tool").is_some());
        assert!(registry.find_tool_provider("nonexistent").is_none());
    }

    #[test]
    fn test_find_skills_by_tag() {
        let dir = TempDir::new().unwrap();
        create_test_skill_with_tags(dir.path(), "image-component", &["component-center"]);
        create_test_skill_with_tags(dir.path(), "other-skill", &["misc"]);

        let mut registry = SkillRegistry::new(dir.path().to_path_buf());
        registry.load_all().unwrap();

        let matches = registry.find_skills_by_tag("component-center");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].manifest.skill.name, "image-component");
    }

    #[test]
    fn test_find_skills_by_any_tag() {
        let dir = TempDir::new().unwrap();
        create_test_skill_with_tags(
            dir.path(),
            "image-component",
            &["capability:generate-image"],
        );
        create_test_skill_with_tags(
            dir.path(),
            "video-component",
            &["capability:generate-video"],
        );

        let mut registry = SkillRegistry::new(dir.path().to_path_buf());
        registry.load_all().unwrap();

        let matches =
            registry.find_skills_by_any_tag(&["capability:generate-image", "unknown-tag"]);
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].manifest.skill.name, "image-component");
    }

    #[test]
    fn test_find_component_skills_by_capability() {
        let dir = TempDir::new().unwrap();
        create_test_skill_with_tags(
            dir.path(),
            "image-component",
            &["component-center", "capability:generate-image"],
        );
        create_test_skill_with_tags(
            dir.path(),
            "plain-image-skill",
            &["capability:generate-image"],
        );

        let mut registry = SkillRegistry::new(dir.path().to_path_buf());
        registry.load_all().unwrap();

        let matches = registry.find_component_skills_by_capability("generate-image");
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].manifest.skill.name, "image-component");
    }

    #[test]
    fn test_visible_skills_for_agent_hides_component_skills_by_default() {
        let dir = TempDir::new().unwrap();
        create_test_skill_with_tags(dir.path(), "general-skill", &["utility"]);
        create_test_skill_with_tags(
            dir.path(),
            "image-component",
            &["component-center", "capability:generate-image"],
        );

        let mut registry = SkillRegistry::new(dir.path().to_path_buf());
        registry.load_all().unwrap();

        let visible = registry.visible_skills_for_agent(&[]);
        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].manifest.skill.name, "general-skill");
    }

    #[test]
    fn test_find_tool_provider_for_agent_skills_requires_component_allowlist() {
        let dir = TempDir::new().unwrap();
        create_test_skill_with_tags(
            dir.path(),
            "image-component",
            &["component-center", "capability:generate-image"],
        );

        let mut registry = SkillRegistry::new(dir.path().to_path_buf());
        registry.load_all().unwrap();

        assert!(registry
            .find_tool_provider_for_agent_skills("image-component_tool", &[])
            .is_none());

        let allowed = vec!["image-component".to_string()];
        let provider = registry
            .find_tool_provider_for_agent_skills("image-component_tool", &allowed)
            .unwrap();
        assert_eq!(provider.manifest.skill.name, "image-component");
    }

    #[test]
    fn test_remove_skill() {
        let dir = TempDir::new().unwrap();
        create_test_skill(dir.path(), "removable");

        let mut registry = SkillRegistry::new(dir.path().to_path_buf());
        registry.load_all().unwrap();
        assert_eq!(registry.count(), 1);

        registry.remove("removable").unwrap();
        assert_eq!(registry.count(), 0);
    }

    #[test]
    fn test_empty_dir() {
        let dir = TempDir::new().unwrap();
        let mut registry = SkillRegistry::new(dir.path().to_path_buf());
        assert_eq!(registry.load_all().unwrap(), 0);
    }

    #[test]
    fn test_frozen_blocks_load() {
        let dir = TempDir::new().unwrap();
        create_test_skill(dir.path(), "blocked");

        let mut registry = SkillRegistry::new(dir.path().to_path_buf());
        registry.freeze();
        assert!(registry.is_frozen());

        // Trying to load a skill should fail
        let result = registry.load_skill(&dir.path().join("blocked"));
        assert!(result.is_err());
    }

    #[test]
    fn test_frozen_after_initial_load() {
        let dir = TempDir::new().unwrap();
        create_test_skill(dir.path(), "initial");
        create_test_skill(dir.path(), "later");

        let mut registry = SkillRegistry::new(dir.path().to_path_buf());
        // Initial load works
        registry.load_all().unwrap();
        assert_eq!(registry.count(), 2);

        // Freeze
        registry.freeze();

        // Dynamic load blocked
        create_test_skill(dir.path(), "new-skill");
        let result = registry.load_skill(&dir.path().join("new-skill"));
        assert!(result.is_err());
        // Still has the original skills
        assert_eq!(registry.count(), 2);
    }

    #[test]
    fn test_registry_auto_convert_skillmd() {
        let dir = TempDir::new().unwrap();

        // Create a SKILL.md-only skill (no skill.toml)
        let skill_dir = dir.path().join("writing-coach");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: writing-coach\ndescription: Helps improve writing\n---\n# Writing Coach\n\nHelp users write better.",
        ).unwrap();

        let mut registry = SkillRegistry::new(dir.path().to_path_buf());
        let count = registry.load_all().unwrap();
        assert_eq!(count, 1, "Should auto-convert and load the SKILL.md skill");

        let skill = registry.get("writing-coach");
        assert!(skill.is_some());
        let manifest = &skill.unwrap().manifest;
        assert_eq!(
            manifest.runtime.runtime_type,
            crate::SkillRuntime::PromptOnly
        );
        assert!(manifest.prompt_context.is_some());

        // Verify that skill.toml was written
        assert!(skill_dir.join("skill.toml").exists());
    }
}
