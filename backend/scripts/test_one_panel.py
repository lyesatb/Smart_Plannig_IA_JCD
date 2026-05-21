from app.config.settings import get_settings
from app.llm.factory import get_chat_llm, parse_llm_json
from app.tools.panel_copy_tool import _explain_single_panel

settings = get_settings()
llm = get_chat_llm(settings, creative_copy=True)
panel = {
    "panel_id": "test-uuid-123",
    "city": "Paris",
    "district": "Gare",
    "format": "DOOH 8m2",
    "daily_traffic": 80000,
    "visibility_score": 90,
    "smart_score": 88.5,
    "poi_nearby": "gare",
}
import json
from app.llm.factory import parse_llm_json_any

prompt = (
    'Réponds UNIQUEMENT en JSON: {"panel_id":"test-uuid-123","explanation":"phrase ici"}\n'
    f"Panneau Paris Gare DOOH score 88"
)
resp = llm.invoke(prompt)
content = getattr(resp, "content", None) or str(resp)
print("RAW:", repr(content[:500]))
try:
    print("PARSED", parse_llm_json(content))
except Exception as e:
    print("ERR parse_llm_json", e)
    try:
        print("PARSED_ANY", parse_llm_json_any(content))
    except Exception as e2:
        print("ERR any", e2)

out = _explain_single_panel(llm, "bio Paris 200k", {"industry": "bio", "city": "Paris"}, panel)
print("OUT:", out)
