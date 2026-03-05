# Changelog

All notable changes to the PSGC MCP Server are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-03-05

### Added

- **Tool: batch_lookup.** Look up multiple PSGC entities in one call (max 50 codes). Returns results in input order with null for codes not found, plus found/not_found/total counts.

- **Tool: query_by_population.** Query entities by population range with sorting. Supports filtering by geographic level, parent scope (prefix matching), and min/max population. Barangay queries require a parent_code. Returns results sorted by population (asc or desc) with configurable limit.

## [1.2.0] - 2026-03-03

### Fixed

- **Parser: recover Income Class and Urban/Rural columns from Excel rich text headers.** ExcelJS returns rich text cell values as objects, not strings. `detectColumns()` was calling `String()` on them, producing `"[object Object]"` which silently failed column detection. Added `cellText()` helper to extract plain text from rich text cells, plus whitespace normalization for multi-line headers. This recovers:
  - `income_class` for 149 cities, 1,493 municipalities, 82 provinces
  - `urban_rural` for all 42,011 barangays (values: U, R, -)

- **Live sample runner: update stale PSGC codes for Q4 2025.** NCR restructured from district-based coding (13-01, 13-07) to flat structure (1380, 1381). Updated test codes for Manila, Quezon City, Makati barangay, and Bulacan.
