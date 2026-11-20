use super::cases;
use super::test_support::{Scenario, call, progress_with};
use super::*;

#[test]
fn rule_ids_are_unique_kebab_case() {
    let mut seen = std::collections::HashSet::new();
    for rule in RULES {
        let kebab = !rule.id.is_empty()
            && rule.id.split('-').all(|p| {
                !p.is_empty()
                    && p.chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
            });
        assert!(kebab, "rule id `{}` must be kebab-case", rule.id);
        assert!(
            seen.insert(rule.id),
            "rule id `{}` is registered twice",
            rule.id
        );
    }
}

#[test]
fn a_working_rule_is_a_state_rule() {
    for rule in RULES {
        assert!(
            rule.source == Source::State || rule.when == When::TurnEnd,
            "rule `{}` reads the turn, so it can only run at the turn end",
            rule.id
        );
    }
}

#[test]
fn every_rule_has_cases() {
    let all = cases::all();
    for case in &all {
        assert!(
            RULES.iter().any(|r| r.id == case.rule),
            "case `{}` names unknown rule `{}`",
            case.name,
            case.rule
        );
    }
    for rule in RULES {
        for expected in [true, false] {
            assert!(
                all.iter()
                    .any(|c| c.rule == rule.id && c.triggers == expected),
                "rule `{}` needs a case in src/nudge/cases.rs where it {}",
                rule.id,
                if expected {
                    "triggers"
                } else {
                    "does not trigger"
                }
            );
        }
    }
}

#[test]
fn every_case_gives_the_expected_result() {
    for case in cases::all() {
        let rule = RULES.iter().find(|r| r.id == case.rule).unwrap();
        let got = !rule.run(&case.scenario.facts()).is_empty();
        assert_eq!(
            got, case.triggers,
            "rule `{}`, case `{}`: expected triggers = {}",
            case.rule, case.name, case.triggers
        );
    }
}

#[test]
fn reminders_carry_the_rule_kind_and_ids() {
    let scenario = Scenario::state(progress_with(false, &[7, 9]));
    let found = RULES
        .iter()
        .find(|r| r.id == "final-result")
        .unwrap()
        .run(&scenario.facts());
    assert_eq!(found.len(), 2);
    assert_eq!(found[0].rule, "final-result");
    assert_eq!(found[0].kind, Kind::Definite);
    assert_eq!(found[0].task_id, Some(7));
    assert!(found[0].text.contains("result add 7 --final"));
}

#[test]
fn a_state_rule_never_sees_the_turn() {
    fn peek(facts: &Facts) -> Vec<Finding> {
        vec![Finding::new(format!(
            "{} {}",
            facts.turn.is_some(),
            facts.message.is_some()
        ))]
    }
    let rule = Rule {
        id: "peek",
        area: Area::Record,
        source: Source::State,
        when: When::Both,
        kind: Kind::Check,
        check: peek,
    };
    let scenario = Scenario::turn("Hi?", vec![call("ls")], None);
    assert_eq!(rule.run(&scenario.facts())[0].text, "false false");
}

#[test]
fn the_table_lists_state_rules_only_and_the_hook_lists_the_rules_of_the_turn_end() {
    let table = progress_with(false, &[3]);
    let reminders = state_reminders(&table, chrono::Utc::now());
    assert_eq!(reminders.len(), 1);
    assert_eq!(reminders[0].rule, "final-result");
    // The table carries what its own build computed.
    let json = serde_json::to_value(&reminders[0]).unwrap();
    assert_eq!(json["rule"], "final-result");
    assert_eq!(json["kind"], "definite");
    assert_eq!(json["taskId"], 3);
    assert!(json.get("messageId").is_none() && json.get("epicId").is_none());

    let scenario = Scenario::turn("Shall I?", vec![call("ls")], Some(table));
    let at_end = turn_end_reminders(&scenario.facts(), RULES);
    let ids: Vec<&str> = at_end.iter().map(|r| r.rule).collect();
    assert_eq!(ids, ["question", "question", "final-result"]);
}

#[test]
fn the_rule_list_of_the_docs_names_every_rule() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    for page in [
        "docs/dev/concepts/agents.md",
        "docs/ja/dev/concepts/agents.md",
    ] {
        let text = std::fs::read_to_string(root.join(page)).unwrap();
        for rule in RULES {
            assert!(
                text.contains(&format!("`{}`", rule.id)),
                "{page} must describe rule `{}` in its rule list: add a row for it",
                rule.id
            );
        }
    }
}
