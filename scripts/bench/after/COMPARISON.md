# Measurement before and after (median of 3 runs; min-max in brackets)

Before: `baseline/` (commit 1a9b2d0). After: this directory (commit 61162c5 plus the test and documentation fixes). Same fixture, seed, procedure and run count. Facts only; no pass or fail is judged.

## pc

| Metric | Before | After |
| --- | --- | --- |
| firstVisibleMs | 1,007 [962-1,382] | 886 [874-916] |
| load.requests.document | 1 [1-1] | 1 [1-1] |
| load.bytes.document | 1,029 [1,029-1,029] | 1,029 [1,029-1,029] |
| load.requests.api | 6 [6-6] | 5 [5-5] |
| load.bytes.api | 2,194,990 [2,194,990-2,194,990] | 171,069 [171,069-171,069] |
| load.requests.static | 16 [16-16] | 19 [19-19] |
| load.bytes.static | 329,099 [329,099-329,099] | 347,494 [347,494-347,494] |
| load.requests.stream | 1 [1-1] | 1 [1-1] |
| load.bytes.stream | 0 [0-0] | 0 [0-0] |
| load.requests.inline | 0 [0-0] | 0 [0-0] |
| load.bytes.inline | 0 [0-0] | 0 [0-0] |
| load.requests.total | 24 [24-24] | 26 [26-26] |
| load.bytes.total | 2,525,118 [2,525,118-2,525,118] | 519,592 [519,592-519,592] |
| heavyOpenMs | 247 [232-322] | 455 [453-493] |
| heavy.requests.document | 0 [0-0] | 0 [0-0] |
| heavy.bytes.document | 0 [0-0] | 0 [0-0] |
| heavy.requests.api | 4 [4-4] | 11 [11-11] |
| heavy.bytes.api | 1,036 [1,036-1,036] | 57,506 [57,506-57,506] |
| heavy.requests.static | 32 [32-32] | 1 [1-1] |
| heavy.bytes.static | 657,163 [657,163-657,163] | 8,528 [8,528-8,528] |
| heavy.requests.stream | 0 [0-0] | 0 [0-0] |
| heavy.bytes.stream | 0 [0-0] | 0 [0-0] |
| heavy.requests.inline | 0 [0-0] | 0 [0-0] |
| heavy.bytes.inline | 0 [0-0] | 0 [0-0] |
| heavy.requests.total | 36 [36-36] | 12 [12-12] |
| heavy.bytes.total | 658,199 [658,199-658,199] | 66,034 [66,034-66,034] |
| domNodes | 10,937 [10,937-10,937] | 8,239 [8,239-8,239] |
| jsHeapUsedBytes | 85,827,584 [85,511,644-87,810,164] | 47,069,376 [46,622,124-47,146,440] |
| longtaskCount | 3 [3-3] | 1 [1-1] |
| longtaskTotalMs | 493 [491-532] | 140 [140-143] |
| statusDetectedMs | 810 [807-909] | n/a |
| statusMs | 3,332 [3,170-3,389] | 31,443 [31,400-31,497] |
| status.requests.document | 0 [0-0] | 0 [0-0] |
| status.bytes.document | 0 [0-0] | 0 [0-0] |
| status.requests.api | 2 [2-2] | 0 [0-0] |
| status.bytes.api | 2,194,071 [2,194,071-2,194,071] | 0 [0-0] |
| status.requests.static | 0 [0-0] | 0 [0-0] |
| status.bytes.static | 0 [0-0] | 0 [0-0] |
| status.requests.stream | 0 [0-0] | 0 [0-0] |
| status.bytes.stream | 0 [0-0] | 0 [0-0] |
| status.requests.inline | 0 [0-0] | 0 [0-0] |
| status.bytes.inline | 0 [0-0] | 0 [0-0] |
| status.requests.total | 2 [2-2] | 0 [0-0] |
| status.bytes.total | 2,194,071 [2,194,071-2,194,071] | 0 [0-0] |
