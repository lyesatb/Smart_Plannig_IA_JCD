from app.agents.smart_planning_agent import run_agent

r = run_agent("Campagne bio Paris Lyon 200k")
print("meta", r.get("meta"))
ex = [p["explanation"] for p in r["recommendation"]["results"][:6]]
print("unique", len(set(ex)), "of", len(ex))
for e in ex:
    print("-", e)
