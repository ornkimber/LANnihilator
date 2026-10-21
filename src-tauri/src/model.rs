use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Adapter {
    pub id: String,
    pub name: String,
    pub description: String,
    pub admin: u32,
    pub media: u32,
    pub problem: Option<u32>,
}

impl Adapter {
    pub fn enabled(&self) -> Option<bool> {
        match (self.admin, self.problem) {
            (_, Some(22)) => Some(false),
            (1, None | Some(0)) => Some(true),
            (2, None | Some(0)) => Some(false),
            _ => None,
        }
    }
}

#[derive(Clone, Default, Deserialize, Serialize)]
pub struct Preferences {
    pub selected: Option<String>,
    #[serde(default)]
    pub muted: bool,
}

#[derive(Serialize)]
pub struct Snapshot {
    pub adapters: Vec<Adapter>,
    pub selected: Option<String>,
    pub muted: bool,
    pub elevated: bool,
}

// Accept only an actual GUID. This is the only caller-supplied value that may
// reach the fixed PowerShell script; display names never enter command text.
pub fn canonical_guid(value: &str) -> Result<String, String> {
    let value = if value.starts_with('{') && value.ends_with('}') {
        &value[1..value.len() - 1]
    } else {
        value
    };
    if value.len() != 36
        || !value.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
    {
        return Err("Invalid adapter identifier. Re-select the adapter in CONFIG.".into());
    }
    Ok(value.to_ascii_lowercase())
}

pub fn selected<'a>(adapters: &'a [Adapter], id: &str) -> Result<&'a Adapter, String> {
    let mut matches = adapters.iter().filter(|adapter| adapter.id == id);
    let adapter = matches
        .next()
        .ok_or("Selected adapter is missing. No other adapter was modified.")?;
    if matches.next().is_some() {
        return Err("Ambiguous adapter identifier. Operation refused.".into());
    }
    Ok(adapter)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn adapter() -> Adapter {
        Adapter {
            id: "target".into(),
            name: "Renamed Ethernet".into(),
            description: "PCI".into(),
            admin: 1,
            media: 2,
            problem: Some(0),
        }
    }
    #[test]
    fn guid_validation_rejects_command_injection() {
        for value in [
            "Ethernet",
            "'; Disable-NetAdapter *; '",
            "",
            "{",
            "é0000000-0000-0000-0000-000000000000",
            "000000000000000000000000000000000000",
        ] {
            assert!(canonical_guid(value).is_err());
        }
        assert_eq!(
            canonical_guid("{12345678-ABCD-4000-8000-000000000001}").unwrap(),
            "12345678-abcd-4000-8000-000000000001"
        );
    }
    #[test]
    fn selection_is_stable_after_rename_and_never_falls_back() {
        let adapters = vec![adapter()];
        assert_eq!(
            selected(&adapters, "target").unwrap().name,
            "Renamed Ethernet"
        );
        assert!(selected(&adapters, "missing").is_err());
    }
    #[test]
    fn duplicate_identity_is_not_actionable() {
        assert!(selected(&[adapter(), adapter()], "target").is_err());
    }
    #[test]
    fn unplugged_does_not_mean_disabled() {
        let mut value = adapter();
        assert_eq!(value.enabled(), Some(true));
        value.admin = 2;
        assert_eq!(value.enabled(), Some(false));
        value.admin = 1;
        value.problem = Some(22);
        assert_eq!(value.enabled(), Some(false));
        value.problem = Some(10);
        assert_eq!(value.enabled(), None);
    }
    #[test]
    fn missing_optional_problem_code_uses_known_admin_state() {
        let mut value = adapter();
        value.problem = None;
        assert_eq!(value.enabled(), Some(true));
        value.admin = 2;
        assert_eq!(value.enabled(), Some(false));
        value.admin = 0;
        assert_eq!(value.enabled(), None);
        let json = r#"{"id":"target","name":"Ethernet","description":"PCI","admin":1,"media":2,"problem":null}"#;
        let decoded: Adapter = serde_json::from_str(json).unwrap();
        assert_eq!(decoded.problem, None);
        assert_eq!(decoded.enabled(), Some(true));
    }
    #[test]
    fn actual_driver_fault_is_not_masked_by_admin_down() {
        let mut value = adapter();
        value.admin = 2;
        value.problem = Some(10);
        assert_eq!(value.enabled(), None);
    }
}
