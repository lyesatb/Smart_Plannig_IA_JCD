import json

from app.config.settings import get_settings
from app.llm.factory import get_chat_llm, parse_llm_json_any
from app.services.recommendation_service import recommend_panels

brief = {"city": "Paris", "cities": ["Paris", "Lyon"], "industry": "bio", "budget": 200000, "top_k": 3}
rec = recommend_panels(brief)
mini = [
    {
        "panel_id": r["panel_id"],
        "city": r["city"],
        "district": r["district"],
        "smart_score": r["smart_score"],
    }
    for r in rec["results"]
]
llm = get_chat_llm(get_settings(), creative_copy=True)
prompt = (
    "Retourne UNIQUEMENT un JSON array sans markdown. "
    'Format: [{"panel_id":"uuid","explanation":"phrase unique en français"}]\n'
    f"Panneaux:\n{json.dumps(mini, ensure_ascii=False)}"
)
resp = llm.invoke(prompt)
content = getattr(resp, "content", None) or str(resp)
print("RAW:", content[:1200])
try:
    d = parse_llm_json_any(content)
    print("PARSED", type(d), d)
except Exception as e:
    print("PARSE ERR", e)
