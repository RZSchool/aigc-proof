# Package Format

## Purpose

Define the `.aigcproof` package boundary.

## Current decision

The extension is `.aigcproof`; ZIP64 is planned as the container. A manifest must be independently verifiable. The container's whole byte stream will not be signed directly; planned signing input combines a normalized manifest, file digests, and an event-chain digest.

## Not decided

Entry naming, limits, canonical digest encoding, and recovery behavior remain open.

## Next

Specify archive safety limits and package test vectors.
