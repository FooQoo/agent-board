//! The order rules of a Detail stream, as one checker both the server tests and the golden
//! examples use.

use std::fmt;

use super::detail::{DetailEvent, DetailResource, ResourceId, Section, Versions};

/// A line or an order that the contract does not allow.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamError(pub String);

impl fmt::Display for StreamError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

fn fail<T>(message: impl Into<String>) -> Result<T, StreamError> {
    Err(StreamError(message.into()))
}

enum State {
    Init,
    /// Between sections: `next` is the index into the requested sections.
    Between {
        next: usize,
    },
    InSection {
        index: usize,
        count: u32,
        acceptance: bool,
    },
    Done,
}

/// Feed events in order with [`StreamValidator::accept`], then call [`StreamValidator::finish`].
pub struct StreamValidator {
    state: State,
    resource: Option<DetailResource>,
    sections: Vec<Section>,
    versions: Versions,
}

impl Default for StreamValidator {
    fn default() -> Self {
        Self::new()
    }
}

impl StreamValidator {
    pub fn new() -> Self {
        Self {
            state: State::Init,
            resource: None,
            sections: Vec::new(),
            versions: Versions::default(),
        }
    }

    pub fn accept(&mut self, event: &DetailEvent) -> Result<(), StreamError> {
        match (&self.state, event) {
            (State::Init, DetailEvent::Start { .. }) => self.start(event),
            (State::Init, _) => fail("the stream must begin with start"),
            (State::Between { next }, DetailEvent::SectionStart { section }) => {
                if self.sections.get(*next) != Some(section) {
                    return fail(format!("{section:?} is not the next requested section"));
                }
                self.state = State::InSection {
                    index: *next,
                    count: 0,
                    acceptance: false,
                };
                Ok(())
            }
            (State::Between { next }, DetailEvent::Complete { versions }) => {
                if *next != self.sections.len() {
                    return fail("complete came before every requested section ended");
                }
                if *versions != self.versions {
                    return fail("complete carries other versions than start");
                }
                self.state = State::Done;
                Ok(())
            }
            (
                State::InSection {
                    index,
                    count,
                    acceptance,
                },
                _,
            ) => self.in_section(*index, *count, *acceptance, event),
            (State::Done, _) => fail("nothing may follow complete"),
            (State::Between { .. }, _) => fail("an item or section-end outside a section"),
        }
    }

    /// The stream is whole only if `complete` arrived.
    pub fn finish(&self) -> Result<(), StreamError> {
        match self.state {
            State::Done => Ok(()),
            _ => fail("the stream ended before complete"),
        }
    }

    fn start(&mut self, event: &DetailEvent) -> Result<(), StreamError> {
        let DetailEvent::Start {
            resource,
            id,
            sections,
            versions,
            ..
        } = event
        else {
            return fail("not a start");
        };
        let id_ok = matches!(
            (resource, id),
            (DetailResource::Task, ResourceId::Task(_))
                | (DetailResource::Epic, ResourceId::Epic(_))
        );
        if !id_ok {
            return fail("the ID type does not fit the resource");
        }
        let allowed: &[Section] = match resource {
            DetailResource::Task => &[Section::Document, Section::History],
            DetailResource::Epic => &[Section::Document],
        };
        let ordered = sections
            .windows(2)
            .all(|pair| pair[0] == Section::Document && pair[1] == Section::History);
        if sections.is_empty() || !ordered || sections.iter().any(|s| !allowed.contains(s)) {
            return fail(
                "sections must be document and/or history, in that order, as the resource has",
            );
        }
        let has = |s: Section| sections.contains(&s);
        if versions.document.is_some() != has(Section::Document)
            || versions.history.is_some() != has(Section::History)
        {
            return fail("versions must name exactly the requested sections");
        }
        self.resource = Some(*resource);
        self.sections = sections.clone();
        self.versions = versions.clone();
        self.state = State::Between { next: 0 };
        Ok(())
    }

    fn in_section(
        &mut self,
        index: usize,
        count: u32,
        acceptance: bool,
        event: &DetailEvent,
    ) -> Result<(), StreamError> {
        let section = self.sections[index];
        let (count, acceptance) = match (section, event) {
            (Section::Document, DetailEvent::Block { .. }) if !acceptance => (count + 1, false),
            (Section::Document, DetailEvent::Block { .. }) => {
                return fail("a block came after an acceptance condition");
            }
            (Section::Document, DetailEvent::Acceptance { .. })
                if self.resource == Some(DetailResource::Task) =>
            {
                (count + 1, true)
            }
            (Section::History, DetailEvent::HistoryItem { .. }) => (count + 1, false),
            (
                _,
                DetailEvent::SectionEnd {
                    section: ended,
                    count: declared,
                },
            ) => {
                if *ended != section {
                    return fail("section-end names another section");
                }
                if *declared != count {
                    return fail(format!(
                        "section-end counts {declared}, the section had {count}"
                    ));
                }
                self.state = State::Between { next: index + 1 };
                return Ok(());
            }
            _ => return fail("this event does not belong in the section"),
        };
        self.state = State::InSection {
            index,
            count,
            acceptance,
        };
        Ok(())
    }
}
