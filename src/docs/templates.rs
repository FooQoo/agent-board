//! The README placed in a `docs/` folder when it is created.

/// The language of the placed README. Callers read the app's language setting
/// and pass the result, so `file_store` never reads the setting itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DocsLocale {
    Ja,
    #[default]
    En,
}

impl DocsLocale {
    /// `"ja"` is Japanese; any other value is English.
    pub fn from_locale(locale: &str) -> DocsLocale {
        if locale == "ja" {
            DocsLocale::Ja
        } else {
            DocsLocale::En
        }
    }

    pub fn readme(self) -> &'static str {
        match self {
            DocsLocale::Ja => include_str!("templates/README.ja.md"),
            DocsLocale::En => include_str!("templates/README.en.md"),
        }
    }
}
