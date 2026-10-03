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
    /// Lowercase machine form (`todo`).
    pub fn as_str(&self) -> &'static str {
        match self {
            Column::Todo => "todo",
            Column::Doing => "doing",
            Column::Done => "done",
        }
    }

    /// Capitalized display form (`Todo`).
    pub fn label(&self) -> &'static str {
        match self {
            Column::Todo => "Todo",
            Column::Doing => "Doing",
            Column::Done => "Done",
        }
    }
}

impl FromStr for Column {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "todo" => Ok(Column::Todo),
            "doing" => Ok(Column::Doing),
            "done" => Ok(Column::Done),
            _ => Err(()),
        }
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
    /// Lowercase machine form (`running`).
    pub fn as_str(&self) -> &'static str {
        match self {
            RunState::Idle => "idle",
            RunState::Running => "running",
            RunState::Pending => "pending",
        }
    }

    /// Capitalized display form (`Running`).
    pub fn label(&self) -> &'static str {
        match self {
            RunState::Idle => "Idle",
            RunState::Running => "Running",
            RunState::Pending => "Pending",
        }
    }
}

impl FromStr for RunState {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "idle" => Ok(RunState::Idle),
            "running" => Ok(RunState::Running),
            "pending" => Ok(RunState::Pending),
            _ => Err(()),
        }
    }
}
