# EchoLayer End-to-End A/B

- mode: DRY-RUN (no cost, wiring check) · trials/condition: 1

| Scenario | Metric | Cold | EchoLayer | Δ |
|---|---|--:|--:|--:|
| db-connection-strategy | cost (USD) | 0.210 | 0.210 | 0% |
| | turns | 1.0 | 1.0 | 0% |
| | output tokens | 4 | 4 | 0% |
| production-api-cors | cost (USD) | 0.210 | 0.210 | 0% |
| | turns | 1.0 | 1.0 | 0% |
| | output tokens | 4 | 4 | 0% |

> Δ is the cold→echolayer reduction. Positive = EchoLayer cheaper/fewer.
> Real runs are non-deterministic — use ≥3 trials and read the trend, not one number.
