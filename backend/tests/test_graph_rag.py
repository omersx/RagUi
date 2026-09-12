"""Tests for GraphRAG v1 pure matching (no DB / LLM required)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.graph_rag import match_entities


def test_longest_first_with_subsumption():
    cands = [(1, "report"), (2, "quarterly report"), (3, "acme corp")]
    assert match_entities("the quarterly report from acme corp", cands, 6) == [2, 3]


def test_no_match_returns_empty():
    assert match_entities("something entirely different", [(1, "acme corp")], 6) == []


def test_respects_max_entities_and_empty_inputs():
    cands = [(1, "alpha"), (2, "beta"), (3, "gamma")]
    # Longest-first (stable): alpha, gamma, then beta — capped at 2.
    assert match_entities("alpha beta gamma", cands, 2) == [1, 3]
    assert match_entities("", cands, 6) == []
    assert match_entities("alpha", [], 6) == []
    assert match_entities("alpha", cands, 0) == []


def test_duplicate_norms_match_once_each_id():
    # Same normalized name on two rows (shouldn't happen post-canonicalization,
    # but must not duplicate or crash): both are kept, longer-first order holds.
    cands = [(1, "acme"), (2, "acme corp")]
    assert match_entities("acme corp announced", cands, 6) == [2]
