# Trading Journal Data Structure for Analysis

Each row contains several fields that describe the trade's parameters and its entire lifecycle.

| Field Name           | Data Type | Description                                                                                                                                      |
| :------------------- | :-------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| `TradeID`            | `string`  | A unique identifier for the trade, generated from the entry timestamp (e.g., `"2024-09-03T18:30:00.000Z"`).                                    |
| `EntryPrice`         | `number`  | The price at which the trade was entered.                                                                                                        |
| `StopLossPrice`      | `number`  | The price at which the stop loss was set for this trade.                                                                                         |
| `Timestamp`          | `string`  | The ISO 8601 timestamp for that specific candle (e.g., `"2024-09-03T18:31:00.000Z"`).                                                              |
| `CandleNumber`       | `number`  | The sequence number of the candle since the trade entry (e.g., `1`, `2`, `3`, ...).                                                              |
| `CurrentPrice_Open`  | `number`  | The opening price of the instrument for this candle.                                                                                             |
| `CurrentPrice_High`  | `number`  | The highest price reached by the instrument during this candle.                                                                                  |
| `CurrentPrice_Low`   | `number`  | The lowest price reached by the instrument during this candle.                                                                                   |
| `CurrentPrice_Close` | `number`  | The closing price of the instrument at the end of this candle.                                                                                   |
| `MFE_R`              | `number`  | **Maximum Favorable Excursion (in R-multiples)**. The peak profit the trade reached, measured in multiples of the initial risk.                      |
| `MAE_R`              | `number`  | **Maximum Adverse Excursion (in R-multiples)**. The maximum unrealized loss (drawdown) the trade experienced, measured in multiples of initial risk. |
| `DrawdownFromMFE_R`  | `number`  | The drawdown from the peak profit (MFE), measured in R-multiples. This is crucial for analyzing trail-stop strategies.                             |
| `Trade Status`       | `string`  | The status of the trade at this candle. It will be `"Active"`, `"StopLoss"` (if the SL was hit), or `"EndOfData"` (if the trade was still active when the data ran out). |

### Nuances for Analysis

To get the most out of this data, consider the following:

1.  **Risk (R) Is the Unit of Measurement**: The key performance metrics (`MFE_R`, `MAE_R`, `DrawdownFromMFE_R`) are normalized by risk. **Risk (R)** is defined as the absolute difference between the `entryPrice` and the `stopLossPrice`. This is a powerful concept because it allows you to compare the performance of different trades on an equal footing, regardless of the instrument's volatility or the trade's size.

2.  **Analyzing MFE (Maximum Favorable Excursion)**: By analyzing the distribution of `MFE_R` across all your trades, you can answer questions like, "What is the most profit my strategy typically generates?" or "Is my take-profit target of 3R realistic, or do most of my trades only reach 1.5R?" This is invaluable for optimizing profit targets.

3.  **Analyzing MAE (Maximum Adverse Excursion)**: MAE tells you how much "pain" you had to endure for a winning trade. If you find that your winning trades consistently have a high MAE (e.g., 0.8R), it might indicate your stop loss is too tight. Conversely, if MAE is always very low, your stop loss might be too wide, and you could be giving up profit.

4.  **Analyzing Drawdown from MFE**: This is a sophisticated metric for testing trailing stop strategies. For example, you can analyze the final `DrawdownFromMFE_R` for all winning trades to determine an optimal trailing stop distance. If winning trades frequently pull back 0.5R from their peak before moving higher, a trailing stop of 0.4R would be triggered too often.