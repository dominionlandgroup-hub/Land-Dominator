"""
In-memory session storage for uploaded CSVs and match results.
No database needed for v1 — everything lives in RAM per server process.
"""
from typing import Dict, Any, Optional
import pandas as pd

# Comps DataFrames keyed by session_id
_comp_sessions: Dict[str, pd.DataFrame] = {}

# Target DataFrames keyed by session_id
_target_sessions: Dict[str, pd.DataFrame] = {}

# Match results keyed by match_id
_match_results: Dict[str, Any] = {}


def store_comps(session_id: str, df: pd.DataFrame) -> None:
    _comp_sessions[session_id] = df


def get_comps(session_id: str) -> Optional[pd.DataFrame]:
    return _comp_sessions.get(session_id)


def store_targets(session_id: str, df: pd.DataFrame) -> None:
    _target_sessions[session_id] = df


def get_targets(session_id: str) -> Optional[pd.DataFrame]:
    return _target_sessions.get(session_id)


def store_match(match_id: str, data: Any) -> None:
    _match_results[match_id] = data


def get_match(match_id: str) -> Optional[Any]:
    return _match_results.get(match_id)


def delete_comp_session(session_id: str) -> None:
    _comp_sessions.pop(session_id, None)


def delete_target_session(session_id: str) -> None:
    _target_sessions.pop(session_id, None)
