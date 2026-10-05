//! Project identity, catalog and change-cursor types.

use std::fmt;
use std::str::FromStr;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::error::SkanError;

const ID_LEN: usize = 32;

fn invalid(field: &str, reason: &str) -> SkanError {
    SkanError::InvalidValue {
        field: field.to_string(),
        reason: reason.to_string(),
    }
}

fn is_lower_hex(text: &str) -> bool {
    text.len() == ID_LEN && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// An immutable project identifier: 32 lowercase hexadecimal digits.
///
/// It is generated once when a project is created and never changes, so it
/// keeps pointing at the same project across renames and never at a project
/// that was later created with the same name.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ProjectId(String);

impl ProjectId {
    /// Generate a new random identifier. A failure of the system random source
    /// is reported as `database_error`.
    pub fn generate() -> Result<ProjectId, SkanError> {
        let mut bytes = [0u8; ID_LEN / 2];
        getrandom::fill(&mut bytes).map_err(|e| SkanError::DatabaseError {
            reason: e.to_string(),
        })?;
        Ok(ProjectId(
            bytes.iter().map(|b| format!("{b:02x}")).collect(),
        ))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl FromStr for ProjectId {
    type Err = SkanError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        if is_lower_hex(s) {
            Ok(ProjectId(s.to_string()))
        } else {
            Err(invalid(
                "projectId",
                "Project IDs are 32 lowercase hexadecimal digits.",
            ))
        }
    }
}

impl fmt::Display for ProjectId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl Serialize for ProjectId {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for ProjectId {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let text = String::deserialize(d)?;
        text.parse()
            .map_err(|e: SkanError| serde::de::Error::custom(e.reason()))
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMeta {
    pub id: ProjectId,
    pub name: String,
    #[serde(with = "crate::clock::serde_utc")]
    pub created_at: DateTime<Utc>,
}

/// The project list (ordered by name) and the catalog revision, read together.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCatalog {
    pub projects: Vec<ProjectMeta>,
    pub catalog_revision: i64,
}

/// Identifies a point in one project's change stream: `<ProjectId>:<revision>`.
///
/// The revision is in `0..=i64::MAX`. A bare integer is not a cursor.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ChangeCursor {
    pub project_id: ProjectId,
    pub revision: i64,
}

impl ChangeCursor {
    pub fn new(project_id: ProjectId, revision: i64) -> Result<ChangeCursor, SkanError> {
        if revision < 0 {
            return Err(invalid("cursor", "A cursor revision cannot be negative."));
        }
        Ok(ChangeCursor {
            project_id,
            revision,
        })
    }
}

impl FromStr for ChangeCursor {
    type Err = SkanError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let bad = || invalid("cursor", "A cursor looks like <project-id>:<revision>.");
        let (id, revision) = s.split_once(':').ok_or_else(bad)?;
        let project_id: ProjectId = id.parse().map_err(|_| bad())?;
        let canonical = !revision.is_empty()
            && revision.bytes().all(|b| b.is_ascii_digit())
            && (revision == "0" || !revision.starts_with('0'));
        if !canonical {
            return Err(bad());
        }
        let revision: i64 = revision.parse().map_err(|_| bad())?;
        Ok(ChangeCursor {
            project_id,
            revision,
        })
    }
}

impl fmt::Display for ChangeCursor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}", self.project_id, self.revision)
    }
}

impl Serialize for ChangeCursor {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for ChangeCursor {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let text = String::deserialize(d)?;
        text.parse()
            .map_err(|e: SkanError| serde::de::Error::custom(e.reason()))
    }
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    const ID: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn project_id_accepts_32_lowercase_hex_digits() {
        let id: ProjectId = ID.parse().unwrap();
        assert_eq!(id.as_str(), ID);
        assert_eq!(id.to_string(), ID);
    }

    #[test]
    fn project_id_rejects_everything_else() {
        for bad in [
            "",
            "0123456789abcdef0123456789abcde",
            "0123456789abcdef0123456789abcdef0",
            "0123456789ABCDEF0123456789ABCDEF",
            "0123456789abcdef0123456789abcdeg",
            " 123456789abcdef0123456789abcdef",
            "0123456789abcdef0123456789abcde\n",
            "0123456789abcdef-123456789abcdef",
            "０123456789abcdef0123456789abcdef",
        ] {
            let err = bad.parse::<ProjectId>().unwrap_err();
            assert!(matches!(err, SkanError::InvalidValue { .. }), "{bad:?}");
        }
    }

    #[test]
    fn generated_ids_are_valid_and_distinct() {
        let a = ProjectId::generate().unwrap();
        let b = ProjectId::generate().unwrap();
        assert_ne!(a, b);
        assert_eq!(a.as_str().parse::<ProjectId>().unwrap(), a);
    }

    #[test]
    fn project_id_serde_is_a_plain_validated_string() {
        let id: ProjectId = ID.parse().unwrap();
        assert_eq!(serde_json::to_string(&id).unwrap(), format!("\"{ID}\""));
        assert_eq!(
            serde_json::from_str::<ProjectId>(&format!("\"{ID}\"")).unwrap(),
            id
        );
        assert!(serde_json::from_str::<ProjectId>("\"nope\"").is_err());
        assert!(serde_json::from_str::<ProjectId>("12").is_err());
    }

    #[test]
    fn project_meta_and_catalog_use_camel_case() {
        let meta = ProjectMeta {
            id: ID.parse().unwrap(),
            name: "A".into(),
            created_at: Utc.with_ymd_and_hms(2026, 10, 2, 1, 8, 0).unwrap(),
        };
        let json = serde_json::to_value(&meta).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"id": ID, "name": "A", "createdAt": "2026-10-02T01:08:00Z"})
        );
        let catalog = ProjectCatalog {
            projects: vec![meta.clone()],
            catalog_revision: 3,
        };
        let json = serde_json::to_value(&catalog).unwrap();
        assert_eq!(json["catalogRevision"], 3);
        assert_eq!(json["projects"][0]["createdAt"], "2026-10-02T01:08:00Z");
        assert_eq!(
            serde_json::from_value::<ProjectCatalog>(json).unwrap(),
            catalog
        );
    }

    #[test]
    fn cursor_parses_displays_and_round_trips() {
        let text = format!("{ID}:42");
        let cursor: ChangeCursor = text.parse().unwrap();
        assert_eq!(cursor.project_id.as_str(), ID);
        assert_eq!(cursor.revision, 42);
        assert_eq!(cursor.to_string(), text);
        assert_eq!(
            serde_json::to_string(&cursor).unwrap(),
            format!("\"{text}\"")
        );
        assert_eq!(
            serde_json::from_str::<ChangeCursor>(&format!("\"{text}\"")).unwrap(),
            cursor
        );
    }

    #[test]
    fn cursor_range_is_zero_to_i64_max() {
        assert_eq!(
            format!("{ID}:0").parse::<ChangeCursor>().unwrap().revision,
            0
        );
        let max = format!("{ID}:9223372036854775807");
        assert_eq!(max.parse::<ChangeCursor>().unwrap().revision, i64::MAX);
        assert!(
            format!("{ID}:9223372036854775808")
                .parse::<ChangeCursor>()
                .is_err()
        );
        assert!(format!("{ID}:-1").parse::<ChangeCursor>().is_err());
        let id: ProjectId = ID.parse().unwrap();
        assert!(ChangeCursor::new(id.clone(), -1).is_err());
        assert_eq!(ChangeCursor::new(id, i64::MAX).unwrap().revision, i64::MAX);
    }

    #[test]
    fn cursor_rejects_malformed_text_including_bare_integers() {
        for bad in [
            "".to_string(),
            "42".to_string(),
            ":42".to_string(),
            ID.to_string(),
            format!("{ID}:"),
            format!("{ID}:+1"),
            format!("{ID}: 1"),
            format!("{ID}:1 "),
            format!("{ID}:01"),
            format!("{ID}:1:2"),
            format!("{ID}:1.0"),
            format!("{ID}:abc"),
            format!("{}:1", ID.to_uppercase()),
            "short:1".to_string(),
        ] {
            let err = bad.parse::<ChangeCursor>().unwrap_err();
            assert!(matches!(err, SkanError::InvalidValue { .. }), "{bad:?}");
        }
        assert!(serde_json::from_str::<ChangeCursor>("42").is_err());
        assert!(serde_json::from_str::<ChangeCursor>("\"42\"").is_err());
    }
}
