//! Value enums shared by the task commands.

use clap::ValueEnum;

use crate::domain::{Actor, Assignee, Column, RunState};

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum ColumnArg {
    Backlog,
    Todo,
    Doing,
    Done,
}

impl ColumnArg {
    pub fn column(self) -> Column {
        match self {
            ColumnArg::Backlog => Column::Backlog,
            ColumnArg::Todo => Column::Todo,
            ColumnArg::Doing => Column::Doing,
            ColumnArg::Done => Column::Done,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum RunStateArg {
    Idle,
    Running,
    Pending,
}

impl RunStateArg {
    pub fn run_state(self) -> RunState {
        match self {
            RunStateArg::Idle => RunState::Idle,
            RunStateArg::Running => RunState::Running,
            RunStateArg::Pending => RunState::Pending,
        }
    }
}

/// The run states an agent or a person reports. Waiting is read from the questions.
#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum ReportStateArg {
    Idle,
    Running,
}

impl ReportStateArg {
    pub fn run_state(self) -> RunState {
        match self {
            ReportStateArg::Idle => RunState::Idle,
            ReportStateArg::Running => RunState::Running,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum ActorArg {
    Ai,
    Human,
}
impl ActorArg {
    pub fn actor(self) -> Actor {
        match self {
            Self::Ai => Actor::Ai,
            Self::Human => Actor::Human,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
pub enum AssigneeArg {
    Ai,
    Human,
}
impl AssigneeArg {
    pub fn assignee(self) -> Assignee {
        match self {
            Self::Ai => Assignee::Ai,
            Self::Human => Assignee::Human,
        }
    }
}
