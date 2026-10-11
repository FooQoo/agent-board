Plan for the board setup. Single line breaks
are kept as line breaks.

## Purpose
Create the board storage with `agboard init`. When the storage already exists, change nothing.

### Notes
Headings below H2 stay inside their section.

## Acceptance criteria
- [x] A board can be created in a new data area
- [x] An existing board is not changed
- [ ] An error is reported when the storage cannot be written
  - [ ] The message names the path

## Steps
1. Check that the storage exists
2. Create the board when it does not
3. Show the result

## Verification
| Scenario | Expected | AC |
|---|---|---|
| First run | A board is created and the command exits with a very long explanatory message that needs scrolling | AC-1 |
| Second run | Nothing changes | AC-2 |

```sh
AGBOARD_HOME=$(mktemp -d) agboard init --name a-very-long-board-name-that-does-not-wrap --description "long line"
```

> Quoted note from a review.

~~Dropped~~ [External link](https://example.com/docs) and [bad link](javascript:alert(1)).

![Unreachable picture](https://example.invalid/picture.png)

<script>alert('not run')</script>
