# E2E Mock Datasets

Small CSV fixtures for exercising Signal's analysis, transformation, and dashboard generation paths.

## support_timeseries.csv

Daily support operations metrics by channel and severity. Useful for time-series dashboards, backlog trends, response time KPIs, and channel filters.

Suggested prompt:

> Build a support operations dashboard showing ticket volume, backlog, CSAT, and response time trends. Include filters for channel and severity.

## sales_region_product.csv

Monthly sales results by region, product category, product, and channel. Useful for grouped rollups, regional comparisons, product mix analysis, and margin/return-rate metrics.

Suggested prompt:

> Create a sales performance dashboard comparing revenue, units, margin, discounts, and return rates by region, product category, and channel.

## nested_events.csv

Product analytics events with stringified nested payload columns. Useful for testing flattening of dict-like fields, list-of-dict item payloads, identifier handling, and event funnel summaries.

Suggested prompt:

> Analyze product usage events, flatten nested properties where useful, and build a dashboard for events, conversions, revenue, devices, and acquisition campaigns.

## messy_quality.csv

Customer health records with missing values, duplicate rows, zero/blank fields, and numeric outliers. Useful for data quality assessment, fill strategies, duplicate detection, and outlier handling.

Suggested prompt:

> Clean the customer health data, identify missing values and outliers, then create a dashboard showing customer spend, engagement, churn risk, NPS, and support load by segment and region.
