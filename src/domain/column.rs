use std::str::FromStr;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Column {
    Todo,
    Doing,
    Done,
}

impl Column {
    pub fn as_str(&self) -> &'static str {
        todo!()
    }

    pub fn label(&self) -> &'static str {
        todo!()
    }
}

impl FromStr for Column {
    type Err = ();

    fn from_str(_s: &str) -> Result<Self, Self::Err> {
        todo!()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunState {
    Idle,
    Running,
    Pending,
}

impl RunState {
    pub fn as_str(&self) -> &'static str {
        todo!()
    }

    pub fn label(&self) -> &'static str {
        todo!()
    }
}

impl FromStr for RunState {
    type Err = ();

    fn from_str(_s: &str) -> Result<Self, Self::Err> {
        todo!()
    }
}
