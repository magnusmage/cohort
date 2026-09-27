---
adr: "2026-09-22-example-pick-threshold"
title: "Raise pick-confidence threshold to 0.87 (fictional example)"
date: 2026-09-22
author: "ada-example"
status: accepted
tags: [example, robotics]
---

# Decision: pick-confidence threshold 0.87

## Context

False-positive pick alerts ran at 6.4% in the week of Sep 15, flooding the
floor tablet and causing two real alerts to be missed.

## Decision

Raise the pallet-detection confidence threshold from 0.78 to 0.87 for aisle
picks; keep 0.78 for dock doors where missed detections are costlier.

## Consequences

- Alert volume down (pilot: 2.9% false positives on aisle 4).
- Slightly slower pick confirmation on low-contrast pallets, which is acceptable.
- Revisit after the Oct 2 pilot review.
