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

## monitor

| Metric | Before | After |
| --- | --- | --- |
| firstVisibleMs | 1,343 [859-1,349] | 137 [130-160] |
| load.requests.document | 1 [1-1] | 1 [1-1] |
| load.bytes.document | 1,093 [1,093-1,093] | 1,093 [1,093-1,093] |
| load.requests.api | 11 [11-11] | 4 [4-4] |
| load.bytes.api | 4,599,133 [4,599,133-4,599,133] | 171,213 [171,213-171,213] |
| load.requests.static | 7 [7-7] | 7 [7-7] |
| load.bytes.static | 254,765 [254,765-254,765] | 251,390 [251,390-251,390] |
| load.requests.stream | 1 [1-1] | 1 [1-1] |
| load.bytes.stream | 0 [0-0] | 0 [0-0] |
| load.requests.inline | 1 [1-1] | 1 [1-1] |
| load.bytes.inline | 0 [0-0] | 0 [0-0] |
| load.requests.total | 21 [21-21] | 14 [14-14] |
| load.bytes.total | 4,854,991 [4,854,991-4,854,991] | 423,696 [423,696-423,696] |
| heavyOpenMs | 282 [273-299] | 464 [431-911] |
| heavy.requests.document | 0 [0-0] | 0 [0-0] |
| heavy.bytes.document | 0 [0-0] | 0 [0-0] |
| heavy.requests.api | 5 [5-5] | 6 [6-6] |
| heavy.bytes.api | 1,530 [1,530-1,530] | 56,526 [56,526-56,526] |
| heavy.requests.static | 34 [34-34] | 1 [1-1] |
| heavy.bytes.static | 661,819 [661,819-661,819] | 8,587 [8,587-8,587] |
| heavy.requests.stream | 0 [0-0] | 0 [0-0] |
| heavy.bytes.stream | 0 [0-0] | 0 [0-0] |
| heavy.requests.inline | 0 [0-0] | 0 [0-0] |
| heavy.bytes.inline | 0 [0-0] | 0 [0-0] |
| heavy.requests.total | 39 [39-39] | 7 [7-7] |
| heavy.bytes.total | 663,349 [663,349-663,349] | 65,113 [65,113-65,113] |
| domNodes | 6,815 [6,815-6,815] | 4,252 [4,252-4,252] |
| jsHeapUsedBytes | 65,593,796 [65,443,128-66,339,956] | 18,703,500 [18,662,412-20,879,124] |
| longtaskCount | 2 [1-2] | 0 [0-0] |
| longtaskTotalMs | 206 [153-229] | 0 [0-0] |
| statusDetectedMs | 1,718 [1,716-1,818] | n/a |
| statusMs | 3,717 [3,566-4,607] | 31,576 [31,464-33,411] |
| status.requests.document | 0 [0-0] | 0 [0-0] |
| status.bytes.document | 0 [0-0] | 0 [0-0] |
| status.requests.api | 3 [3-3] | 0 [0-0] |
| status.bytes.api | 2,194,633 [2,194,633-2,194,633] | 0 [0-0] |
| status.requests.static | 0 [0-0] | 0 [0-0] |
| status.bytes.static | 0 [0-0] | 0 [0-0] |
| status.requests.stream | 0 [0-0] | 0 [0-0] |
| status.bytes.stream | 0 [0-0] | 0 [0-0] |
| status.requests.inline | 0 [0-0] | 0 [0-0] |
| status.bytes.inline | 0 [0-0] | 0 [0-0] |
| status.requests.total | 3 [3-3] | 0 [0-0] |
| status.bytes.total | 2,194,633 [2,194,633-2,194,633] | 0 [0-0] |

## Notes on the measurement

- The status change is made while the heavy card's drawer is open, as in the baseline procedure. After the change no request followed within the 30 s wait, so `statusDetectedMs` is n/a and `statusMs` is the length of that wait. The page holds automatic updates while a drawer is open and for 3 seconds after it closes.
- `scripts/bench/measure.mjs` now returns null instead of failing when no request follows the status change, and accepts ports 9320-9329 as well as 9210-9219.
