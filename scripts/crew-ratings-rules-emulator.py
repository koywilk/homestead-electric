# Rate Your Crew rules test (34 cases). Needs the Firestore emulator + Java, so it is NOT in prebuild.
# Run: firebase emulators:exec --only firestore --project demo-hz "python3 scripts/crew-ratings-rules-emulator.py"
# (with a firebase.json whose firestore.rules points at firestore.rules, emulator port 8085)
import json,urllib.request,sys
B="http://127.0.0.1:8085/v1/projects/demo-hz/databases/(default)/documents"
T="c8b870a94e086c0b25f822c8fed091bd"
def call(method,path,body=None,owner=False):
    h={"Content-Type":"application/json"}
    if owner: h["Authorization"]="Bearer owner"
    req=urllib.request.Request(B+path,data=json.dumps(body).encode() if body is not None else None,method=method,headers=h)
    try:
        with urllib.request.urlopen(req) as r: return r.status
    except urllib.error.HTTPError as e: return e.code
s=lambda v:{"stringValue":v}
i=lambda v:{"integerValue":str(v)}
def m(d): return {"mapValue":{"fields":d}}
K=["quality","pace","reliability","attitude","leading"]
def ans(sc=3,why="fine work",kudos=None,extra=None,token=T,rid="u_1788878028060",pid="braden_davis",other=""):
    f={"roundId":s("2026-11-16"),"raterToken":s(token),"raterId":s(rid),"personId":s(pid),
       "scores":m({k:i(sc[k] if isinstance(sc,dict) else sc) for k in K}),"why":m({k:s(why[k] if isinstance(why,dict) else why) for k in K}),
       "other":s(other),"updatedAt":s("2026-11-16T22:00:00Z")}
    if kudos is not None: f["kudos"]=s(kudos)
    if extra: f.update(extra)
    return {"fields":f}
# seed (owner bypasses rules)
call("PATCH","/crewRaters/"+T,{"fields":{"raterId":s("u_1788878028060"),"name":s("Zane"),"people":{"arrayValue":{"values":[s("braden_davis")]}}}},owner=True)
call("PATCH","/crewRatingRounds/current",{"fields":{"id":s("2026-11-16"),"closesAt":{"timestampValue":"2099-01-01T00:00:00Z"}}},owner=True)
doc="/crewRatings/2026-11-16__%s__braden_davis"%T
fb="/crewFeedback/2026-11-16__%s"%T
def fbdoc(text="Better trucks please",token=T,rid="u_1788878028060",extra=None):
    f={"roundId":s("2026-11-16"),"raterToken":s(token),"raterId":s(rid),"text":s(text),"updatedAt":s("2026-11-16T22:00:00Z")}
    if extra: f.update(extra)
    return {"fields":f}
tests=[
 ("valid, all Solid, empty whys",200,lambda:call("PATCH",doc,ans(3,""))),
 ("valid, 4 with why + kudos",200,lambda:call("PATCH",doc,ans(4,"strong work",kudos="Stayed late to finish"))),
 ("valid, mixed: 3 empty, 2 with why",200,lambda:call("PATCH",doc,ans({"quality":3,"pace":2,"reliability":3,"attitude":4,"leading":3},{"quality":"","pace":"slow","reliability":"","attitude":"great","leading":""}))),
 ("denied: a 4 with empty why",403,lambda:call("PATCH",doc,ans({"quality":4,"pace":3,"reliability":3,"attitude":3,"leading":3},{"quality":"","pace":"","reliability":"","attitude":"","leading":""}))),
 ("denied: a 1 with 2-char why",403,lambda:call("PATCH",doc,ans({"quality":1,"pace":3,"reliability":3,"attitude":3,"leading":3},{"quality":"no","pace":"","reliability":"","attitude":"","leading":""}))),
 ("denied: kudos over 500",403,lambda:call("PATCH",doc,ans(3,"",kudos="x"*501))),
 ("denied: kudos not a string",403,lambda:call("PATCH",doc,ans(3,"",extra={"kudos":i(5)}))),
 ("denied: extra field (pay)",403,lambda:call("PATCH",doc,ans(3,"",extra={"pay":s("x")}))),
 ("denied: score 5",403,lambda:call("PATCH",doc,ans(5,"x"*5))),
 ("denied: person not on list",403,lambda:call("PATCH","/crewRatings/2026-11-16__%s__austin_schut"%T,ans(3,"",pid="austin_schut"))),
 ("denied: why over 500",403,lambda:call("PATCH",doc,ans(4,"x"*501))),
 ("feedback valid",200,lambda:call("PATCH",fb,fbdoc())),
 ("feedback valid (edit)",200,lambda:call("PATCH",fb,fbdoc("Better trucks and a break room"))),
 ("denied: feedback too short",403,lambda:call("PATCH",fb,fbdoc("ok"))),
 ("denied: feedback over 1000",403,lambda:call("PATCH",fb,fbdoc("x"*1001))),
 ("denied: feedback fake token",403,lambda:call("PATCH","/crewFeedback/2026-11-16__deadbeef",fbdoc(token="deadbeef"))),
 ("denied: feedback wrong rater id",403,lambda:call("PATCH",fb,fbdoc(rid="u_other"))),
 ("denied: feedback extra field",403,lambda:call("PATCH",fb,fbdoc(extra={"name":s("Zane")}))),
 ("denied: feedback list",403,lambda:call("GET","/crewFeedback")),
 ("denied: feedback delete",403,lambda:call("DELETE",fb)),
 ("denied: answers list",403,lambda:call("GET","/crewRatings")),
 ("get own answer",200,lambda:call("GET",doc)),
]

UK=["direction","available","obstacles","fair","followthrough","listens","setup"]
up="/crewUpward/2026-11-16__%s"%T
def updoc(sc=3,start="Give more notice",stop="",token=T,rid="u_1788878028060",extra=None,scores=None):
    f={"roundId":s("2026-11-16"),"raterToken":s(token),"raterId":s(rid),
       "scores":m(scores if scores is not None else {k:i(sc) for k in UK}),"start":s(start),"stop":s(stop),"updatedAt":s("2026-11-16T22:00:00Z")}
    if extra: f.update(extra)
    return {"fields":f}
tests+=[
 ("upward valid",200,lambda:call("PATCH",up,updoc())),
 ("upward valid (edit, empty start/stop)",200,lambda:call("PATCH",up,updoc(4,"",""))),
 ("denied: upward score 5",403,lambda:call("PATCH",up,updoc(scores={**{k:i(3) for k in UK},"listens":i(5)}))),
 ("denied: upward missing a question",403,lambda:call("PATCH",up,updoc(scores={k:i(3) for k in UK[:-1]}))),
 ("denied: upward extra question",403,lambda:call("PATCH",up,updoc(scores={**{k:i(3) for k in UK},"pay":i(3)}))),
 ("denied: upward start over 500",403,lambda:call("PATCH",up,updoc(start="x"*501))),
 ("denied: upward fake token",403,lambda:call("PATCH","/crewUpward/2026-11-16__deadbeef",updoc(token="deadbeef"))),
 ("denied: upward wrong rater id",403,lambda:call("PATCH",up,updoc(rid="u_other"))),
 ("denied: upward extra field",403,lambda:call("PATCH",up,updoc(extra={"name":s("Zane")}))),
 ("denied: upward list",403,lambda:call("GET","/crewUpward")),
 ("denied: upward delete",403,lambda:call("DELETE",up)),
 ("get own upward answer",200,lambda:call("GET",up)),
]
bad=0
for name,want,fn in tests:
    got=fn(); ok=got==want; bad+= (not ok)
    print(("PASS" if ok else "FAIL"),name,"(want %d got %d)"%(want,got))
print("FAILURES:",bad)
