//! TOML values as JSON, so that the `[hooks]` of a Codex `config.toml` is
//! read with the same code as a JSON settings file.

use serde_json::Value;
use toml_edit::Item;

pub(super) fn item_to_json(item: &Item) -> Value {
    match item {
        Item::Value(value) => value_to_json(value),
        Item::Table(table) => Value::Object(
            table
                .iter()
                .map(|(key, item)| (key.to_owned(), item_to_json(item)))
                .collect(),
        ),
        Item::ArrayOfTables(tables) => Value::Array(
            tables
                .iter()
                .map(|table| item_to_json(&Item::Table(table.clone())))
                .collect(),
        ),
        Item::None => Value::Null,
    }
}

fn value_to_json(value: &toml_edit::Value) -> Value {
    use toml_edit::Value as T;
    match value {
        T::String(text) => Value::String(text.value().clone()),
        T::Integer(number) => Value::from(*number.value()),
        T::Float(number) => Value::from(*number.value()),
        T::Boolean(flag) => Value::Bool(*flag.value()),
        T::Datetime(date) => Value::String(date.value().to_string()),
        T::Array(items) => Value::Array(items.iter().map(value_to_json).collect()),
        T::InlineTable(table) => Value::Object(
            table
                .iter()
                .map(|(key, value)| (key.to_owned(), value_to_json(value)))
                .collect(),
        ),
    }
}
