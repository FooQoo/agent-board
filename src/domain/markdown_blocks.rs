//! Splitting a Markdown body into top-level blocks. No I/O.

use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag};

/// What a block is for the renderer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockKind {
    Markdown,
    Mermaid,
}

/// One piece of a body. Concatenating the pieces gives the body back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Block {
    pub kind: BlockKind,
    pub text: String,
}

/// Neighbouring small blocks are joined until they reach about this many characters.
const JOIN_LIMIT: usize = 2_000;

/// Split `body` at top-level block boundaries (CommonMark with the GFM extensions).
///
/// Lists, tables, code fences and quotes are never cut, a fence whose language is `mermaid`
/// is a block of its own, and neighbouring small blocks are joined up to about 2,000
/// characters. A document with a footnote or a link reference definition, one that the parser
/// cannot split cleanly, or a split whose pieces do not add up to the body is one block.
pub fn split_blocks(body: &str) -> Vec<Block> {
    if body.is_empty() {
        return Vec::new();
    }
    match top_level_pieces(body) {
        Some(pieces) if joined_len(&pieces) == body.len() => join_small(pieces),
        _ => vec![whole(body)],
    }
}

fn whole(body: &str) -> Block {
    Block {
        kind: BlockKind::Markdown,
        text: body.to_string(),
    }
}

fn joined_len(pieces: &[Block]) -> usize {
    pieces.iter().map(|p| p.text.len()).sum()
}

/// The top-level blocks, each running up to the line where the next one starts. `None` when the
/// document must stay whole.
fn top_level_pieces(body: &str) -> Option<Vec<Block>> {
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_GFM;
    let mut parser = Parser::new_ext(body, options).into_offset_iter();
    let mut depth = 0usize;
    let mut starts: Vec<(usize, bool)> = Vec::new();
    for (event, range) in parser.by_ref() {
        match event {
            Event::Start(Tag::FootnoteDefinition(_)) => return None,
            Event::Start(tag) => {
                if depth == 0 {
                    let mermaid = matches!(
                        &tag,
                        Tag::CodeBlock(CodeBlockKind::Fenced(info))
                            if info.split_whitespace().next()
                                .is_some_and(|word| word.eq_ignore_ascii_case("mermaid"))
                    );
                    starts.push((range.start, mermaid));
                }
                depth += 1;
            }
            Event::End(_) => depth = depth.saturating_sub(1),
            Event::Rule if depth == 0 => starts.push((range.start, false)),
            _ => {}
        }
    }
    if parser.reference_definitions().iter().next().is_some() {
        return None;
    }
    if starts.is_empty() {
        return None;
    }
    let mut cuts: Vec<(usize, bool)> = Vec::with_capacity(starts.len());
    for (offset, mermaid) in starts {
        let line = body.get(..offset)?.rfind('\n').map_or(0, |i| i + 1);
        if cuts.last().is_some_and(|(last, _)| *last >= line) {
            return None;
        }
        cuts.push((line, mermaid));
    }
    cuts[0].0 = 0;
    let mut pieces = Vec::with_capacity(cuts.len());
    for (i, (from, mermaid)) in cuts.iter().enumerate() {
        let to = cuts.get(i + 1).map_or(body.len(), |(next, _)| *next);
        pieces.push(Block {
            kind: if *mermaid {
                BlockKind::Mermaid
            } else {
                BlockKind::Markdown
            },
            text: body.get(*from..to)?.to_string(),
        });
    }
    Some(pieces)
}

/// Join neighbouring Markdown pieces while the result stays within [`JOIN_LIMIT`] characters.
fn join_small(pieces: Vec<Block>) -> Vec<Block> {
    let mut blocks: Vec<Block> = Vec::new();
    let mut size = 0usize;
    for piece in pieces {
        let chars = piece.text.chars().count();
        match blocks.last_mut() {
            Some(last)
                if last.kind == BlockKind::Markdown
                    && piece.kind == BlockKind::Markdown
                    && size + chars <= JOIN_LIMIT =>
            {
                last.text.push_str(&piece.text);
                size += chars;
            }
            _ => {
                size = chars;
                blocks.push(piece);
            }
        }
    }
    blocks
}

#[cfg(test)]
mod tests {
    use super::*;

    fn joined(blocks: &[Block]) -> String {
        blocks.iter().map(|b| b.text.as_str()).collect()
    }

    fn filler(chars: usize) -> String {
        let mut text = String::new();
        let mut n = 0;
        while text.chars().count() < chars {
            text.push_str(&format!(
                "## Section {n}\n\nParagraph number {n} with some words in it.\n\n"
            ));
            n += 1;
        }
        text
    }

    fn corpus() -> Vec<(&'static str, String)> {
        let mut big = filler(50_000);
        big.push_str("```mermaid\ngraph LR\n  A --> B\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n- x\n  - y\n");
        vec![
            ("empty", String::new()),
            ("blank", "\n\n".to_string()),
            ("headings", "# One\n\ntext\n\n## Two\n\nmore\n".to_string()),
            ("no trailing newline", "# One\n\ntext".to_string()),
            (
                "nested list",
                "- a\n  - b\n    - c\n- d\n\n1. one\n2. two\n".to_string(),
            ),
            (
                "table",
                "| a | b |\n| - | - |\n| 1 | 2 |\n\nafter\n".to_string(),
            ),
            (
                "fence",
                "```rust\nfn main() {}\n\nlet x = 1;\n```\n\ntext\n".to_string(),
            ),
            ("footnote", "Text[^1].\n\n[^1]: The note.\n".to_string()),
            (
                "reference link",
                "See [the site][s].\n\n[s]: https://example.com\n".to_string(),
            ),
            ("html block", "<div>\n\nhi\n\n</div>\n\ntext\n".to_string()),
            (
                "crlf",
                "# One\r\n\r\ntext\r\n\r\n- a\r\n- b\r\n".to_string(),
            ),
            (
                "multibyte",
                "# 見出し\n\n日本語の段落。\n\n> 引用\n".to_string(),
            ),
            ("leading blank lines", "\n\n# Title\n\ntext\n".to_string()),
            ("big", big),
        ]
    }

    #[test]
    fn concatenating_the_blocks_gives_the_body_back() {
        for (name, body) in corpus() {
            let blocks = split_blocks(&body);
            assert_eq!(joined(&blocks), body, "{name}");
            if !body.is_empty() {
                assert!(!blocks.is_empty(), "{name} has no block");
            }
        }
    }

    #[test]
    fn a_document_with_a_footnote_or_a_reference_link_is_one_block() {
        for (name, body) in corpus() {
            if name == "footnote" || name == "reference link" {
                let blocks = split_blocks(&body);
                assert_eq!(blocks.len(), 1, "{name}");
                assert_eq!(blocks[0].kind, BlockKind::Markdown, "{name}");
            }
        }
        let long = format!("{}[^n]: late note\n", filler(6_000));
        assert_eq!(split_blocks(&long).len(), 1);
        let long = format!("{}[ref]: https://example.com\n", filler(6_000));
        assert_eq!(split_blocks(&long).len(), 1);
    }

    #[test]
    fn a_mermaid_fence_is_its_own_block() {
        let body = "intro\n\n```mermaid\ngraph LR\n  A --> B\n```\n\noutro\n";
        let blocks = split_blocks(body);
        assert_eq!(blocks.len(), 3, "{blocks:?}");
        assert_eq!(blocks[0].kind, BlockKind::Markdown);
        assert_eq!(blocks[1].kind, BlockKind::Mermaid);
        assert_eq!(blocks[1].text, "```mermaid\ngraph LR\n  A --> B\n```\n\n");
        assert_eq!(blocks[2].kind, BlockKind::Markdown);
        assert_eq!(joined(&blocks), body);
        let other = split_blocks("```rust\nfn f() {}\n```\n");
        assert!(other.iter().all(|b| b.kind == BlockKind::Markdown));
    }

    /// The block that holds `needle`, which must lie wholly in one block.
    fn holder<'a>(blocks: &'a [Block], needle: &str) -> &'a Block {
        let found: Vec<&Block> = blocks.iter().filter(|b| b.text.contains(needle)).collect();
        assert_eq!(found.len(), 1, "{needle:?} is cut or missing in {blocks:?}");
        found[0]
    }

    #[test]
    fn code_fences_tables_and_lists_are_never_cut() {
        let pad = filler(5_000);
        let fence = format!(
            "```text\n# not a heading\n\n{}\n\nlast line\n```\n\n",
            "x".repeat(3_000)
        );
        let table = "| a | b |\n| - | - |\n| row-one | 1 |\n| row-two | 2 |\n\n";
        let list = format!(
            "- first\n\n  continued paragraph\n\n- second\n  - nested\n\n- third {}\n\n",
            "y".repeat(2_500)
        );
        let body = format!("{pad}{fence}{pad}{table}{pad}{list}{pad}");
        let blocks = split_blocks(&body);
        assert_eq!(joined(&blocks), body);
        let f = holder(&blocks, "last line");
        assert!(f.text.contains("```text") && f.text.contains("# not a heading"));
        let t = holder(&blocks, "row-two");
        assert!(t.text.contains("| a | b |") && t.text.contains("row-one"));
        let l = holder(&blocks, "- third");
        assert!(
            l.text.contains("- first")
                && l.text.contains("continued paragraph")
                && l.text.contains("- nested")
        );
    }

    #[test]
    fn small_neighbours_are_joined_and_big_ones_stay_whole() {
        let body = filler(30_000);
        let blocks = split_blocks(&body);
        assert!(blocks.len() > 10 && blocks.len() < 40, "{}", blocks.len());
        for block in &blocks {
            assert!(
                block.text.chars().count() <= 2_100,
                "{}",
                block.text.chars().count()
            );
        }
        let one = format!("```\n{}\n```\n", "z".repeat(5_000));
        let blocks = split_blocks(&one);
        assert_eq!(blocks.len(), 1);
    }
}
