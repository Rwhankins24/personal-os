#!/bin/bash
# ─────────────────────────────────────────────────────────
# personal-os — Email Report Push (rebuilt 2026-05-15)
# Minimal clean payloads matching webhook schema exactly
# Run: bash ~/personal-os/data/push_email_report.sh
# ─────────────────────────────────────────────────────────

WEBHOOK="https://personal-os-five-black.vercel.app/api/webhooks?type=email"
SUCCESS=0
FAIL=0

push() {
  local LABEL="$1"
  local PAYLOAD="$2"
  RESP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$WEBHOOK" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD" \
    --max-time 15)
  if [[ "$RESP" == "200" || "$RESP" == "201" ]]; then
    echo "✓ $LABEL"
    SUCCESS=$((SUCCESS+1))
  else
    echo "✗ $LABEL  [HTTP $RESP]"
    FAIL=$((FAIL+1))
  fi
}

echo '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
echo '  PERSONAL OS — EMAIL PUSH  (May 15 2026)'
echo '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
echo ''
echo '── BUCKET 1 — NEEDS REPLY (6) ──────────'

push "Pacific Fusion — Action Items" \
'{"from_address":"HenleyL@claycorp.com","from_name":"Lulu Henley","subject":"Pacific Fusion Action Items for Today Next Week","thread_subject":"Pacific Fusion Action Items for Today Next Week","body_preview":"Henley sent revised sublist asking Ryan to weigh in on interiors cost breakout and confirm direction before Tuesday workshops.","received_at":"2026-05-08T13:05:00Z","status":"needs_reply","importance":"normal","bucket":1,"tags":["INTERNAL","HAS_ATTACHMENT","AGING"],"days_waiting":7,"urgency":"critical","followed_up":false,"cross_reference_status":"new","is_internal":true,"has_attachment":true,"is_time_sensitive":false,"has_contract_language":false,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

push "Project Solis — CD Drawing Bidder List" \
'{"from_address":"TinneyC@claycorp.com","from_name":"Chris Tinney","subject":"Project Solis CD Drawing Bidder List","thread_subject":"Project Solis CD Drawing Bidder List","body_preview":"Tinney asking to flag prequalified vs non-prequalified subs on bidder list and confirm whether bidding finishes at CD stage.","received_at":"2026-05-08T13:12:00Z","status":"needs_reply","importance":"normal","bucket":1,"tags":["INTERNAL","HAS_ATTACHMENT","AGING"],"days_waiting":7,"urgency":"critical","followed_up":false,"cross_reference_status":"new","is_internal":true,"has_attachment":true,"is_time_sensitive":false,"has_contract_language":false,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

push "PNM and PF Syncs — Transformer Pad" \
'{"from_address":"gannon.chavez@pnm.com","from_name":"Gannon Chavez","subject":"PNM and PF Syncs Transformer Pad Design Standard","thread_subject":"PNM and PF Syncs Transformer Pad Design Standard","body_preview":"Chavez attached PNM transformer pad design standard. Asking Ryan to advise on relocation approach and confirm when road construction starts.","received_at":"2026-05-14T17:40:00Z","status":"needs_reply","importance":"normal","bucket":1,"tags":["EXTERNAL","HAS_ATTACHMENT","TIME_SENSITIVE"],"days_waiting":1,"urgency":"elevated","followed_up":false,"cross_reference_status":"new","is_internal":false,"has_attachment":true,"is_time_sensitive":true,"has_contract_language":false,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

push "Clayco — Letter of Authorization Solis" \
'{"from_address":"AbbottR@claycorp.com","from_name":"Ryan Abbott","subject":"Clayco Letter of Authorization Solis","thread_subject":"Clayco Letter of Authorization Solis","body_preview":"Abbott replied: also need to cover Chris Tinney. Ryan needs to update and reissue LOA to include Tinney before it goes back with invoice.","received_at":"2026-05-14T03:06:00Z","status":"needs_reply","importance":"normal","bucket":1,"tags":["INTERNAL","CONTRACT_LANGUAGE"],"days_waiting":1,"urgency":"normal","followed_up":false,"cross_reference_status":"new","is_internal":true,"has_attachment":false,"is_time_sensitive":false,"has_contract_language":true,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

push "Solis — Structural Preloading" \
'{"from_address":"courtney@pacificfusion.com","from_name":"Courtney (PF)","subject":"Solis Structural Preloading Conversation","thread_subject":"Solis Structural Preloading Conversation","body_preview":"PF launched preloading coordination thread with WGI and TT. Ryan needs to confirm preloading scope approach and sequence.","received_at":"2026-05-14T17:35:00Z","status":"needs_reply","importance":"normal","bucket":1,"tags":["EXTERNAL"],"days_waiting":1,"urgency":"elevated","followed_up":false,"cross_reference_status":"new","is_internal":false,"has_attachment":false,"is_time_sensitive":false,"has_contract_language":false,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

push "Baldwin and Clayco PF Insurance" \
'{"from_address":"sarah.shepard@baldwin.com","from_name":"Sarah Shepard McGuinness","subject":"Baldwin and Clayco PF Insurance Final Discussion","thread_subject":"Baldwin and Clayco PF Insurance Final Discussion","body_preview":"Sarah replied with all changes accepted and Exhibit B attached. Asking Ryan to formally accept terms so it can go to legal.","received_at":"2026-05-15T03:26:00Z","status":"needs_reply","importance":"normal","bucket":1,"tags":["EXTERNAL","CONTRACT_LANGUAGE","HAS_ATTACHMENT"],"days_waiting":0,"urgency":"elevated","followed_up":false,"cross_reference_status":"new","is_internal":false,"has_attachment":true,"is_time_sensitive":false,"has_contract_language":true,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

echo '── BUCKET 2 — WAITING ON THEM (3) ──────────'

push "Pacific Fusion DS3 — Structural Weekly" \
'{"from_address":"mark.koenigs@thorntontomasetti.com","from_name":"Mark Koenigs","subject":"Pacific Fusion DS3 Structural Weekly","thread_subject":"Pacific Fusion DS3 Structural Weekly","body_preview":"Ryan last message 7d ago: carry 3.5M, asked cost per ton on steel and stainless plate. No reply from TT or PF.","received_at":"2026-05-08T15:51:00Z","status":"waiting_on","importance":"normal","bucket":2,"tags":["EXTERNAL","AGING"],"days_waiting":7,"urgency":"critical","followed_up":false,"cross_reference_status":"new","is_internal":false,"has_attachment":false,"is_time_sensitive":false,"has_contract_language":false,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

push "DS3 Infra — Leadership Discussion" \
'{"from_address":"TigheC@claycorp.com","from_name":"Conor Tighe","subject":"DS3 Infra Leadership Discussion","thread_subject":"DS3 Infra Leadership Discussion","body_preview":"Ryan sent strategic notes to Conor on DS3: savings breakdown ~50M, progressive GMP approach. Multiple follow-ups sent. Waiting on Clayco leadership.","received_at":"2026-05-14T03:11:00Z","status":"waiting_on","importance":"normal","bucket":2,"tags":["INTERNAL"],"days_waiting":1,"urgency":"normal","followed_up":false,"cross_reference_status":"new","is_internal":true,"has_attachment":false,"is_time_sensitive":false,"has_contract_language":false,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

push "Project Solis — Elevation Study and Fire Protection" \
'{"from_address":"rebekah.bellum@stantec.com","from_name":"Rebekah Bellum","subject":"Project Solis Elevation Study and Fire Protection","thread_subject":"Project Solis Elevation Study and Fire Protection","body_preview":"Ryan followed up late night May 14 prompting Rebekah for next step on elevation study. Waiting on Stantec to confirm path forward.","received_at":"2026-05-14T20:00:00Z","status":"waiting_on","importance":"normal","bucket":2,"tags":["EXTERNAL"],"days_waiting":2,"urgency":"elevated","followed_up":false,"cross_reference_status":"new","is_internal":false,"has_attachment":false,"is_time_sensitive":false,"has_contract_language":false,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

echo '── BUCKET 3 — OVERSIGHT (10) ──────────'

push "BESS Fire Protection Drawings" \
'{"from_address":"appelbauml@theljc.com","from_name":"L. Appelbaum","subject":"BESS 5MWh 20MWh Fire Protection Drawings","thread_subject":"BESS 5MWh 20MWh Fire Protection Drawings","body_preview":"LJC Appelbaum forwarding updated fire protection drawings for BESS units. Ryan looped in for oversight.","received_at":"2026-05-14T19:52:00Z","status":"read","importance":"normal","bucket":3,"tags":["EXTERNAL","HAS_ATTACHMENT"],"days_waiting":1,"urgency":"normal","followed_up":false,"cross_reference_status":"new","is_internal":false,"has_attachment":true,"is_time_sensitive":false,"has_contract_language":false,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

push "Gotion Solar — 30% Design Deliverables" \
'{"from_address":"taozhihan@gotion.com.cn","from_name":"Tao Zhihan","subject":"Gotion Solar 30% Design Deliverables","thread_subject":"Gotion Solar 30% Design Deliverables","body_preview":"Gotion and LJC Appelbaum active thread on 30% design deliverable review. Multiple rounds of comment. Ryan looped in for awareness.","received_at":"2026-05-14T20:59:00Z","status":"read","importance":"normal","bucket":3,"tags":["EXTERNAL","HAS_ATTACHMENT"],"days_waiting":1,"urgency":"normal","followed_up":false,"cross_reference_status":"new","is_internal":false,"has_attachment":true,"is_time_sensitive":false,"has_contract_language":false,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

push "Project Solis — Geopier Design Kick-off" \
'{"from_address":"fang.fang@thorntontomasetti.com","from_name":"Fang Fang","subject":"Project Solis Geopier Design Kick-off","thread_subject":"Project Solis Geopier Design Kick-off","body_preview":"TT and WGI coordinating Geopier design kick-off per Solis ground improvement scope. Ryan looped in for oversight.","received_at":"2026-05-13T23:04:00Z","status":"read","importance":"normal","bucket":3,"tags":["EXTERNAL","HAS_ATTACHMENT"],"days_waiting":2,"urgency":"normal","followed_up":false,"cross_reference_status":"new","is_internal":false,"has_attachment":true,"is_time_sensitive":false,"has_contract_language":false,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

push "Project Sun — Invitation to Show Interest" \
'{"from_address":"dario.maggiorelli@bhm.com","from_name":"Dario Maggiorelli","subject":"Project Sun Invitation to Show Interest","thread_subject":"Project Sun Invitation to Show Interest","body_preview":"Ryan submitted response May 11; BHM acknowledged. Pursuit in early qualification stage. FYI tracking only.","received_at":"2026-05-11T15:43:00Z","status":"read","importance":"normal","bucket":3,"tags":["EXTERNAL"],"days_waiting":4,"urgency":"normal","followed_up":false,"cross_reference_status":"new","is_internal":false,"has_attachment":false,"is_time_sensitive":false,"has_contract_language":false,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

push "VE Forecast Reduction Opportunities HOLD" \
'{"from_address":"rebekah.bellum@stantec.com","from_name":"Rebekah Bellum","subject":"VE Forecast Reduction Opportunities HOLD","thread_subject":"VE Forecast Reduction Opportunities HOLD","body_preview":"Stantec put VE forecast review on hold pending scope decisions. Ryan aware; no action required until hold lifted.","received_at":"2026-05-12T14:00:00Z","status":"read","importance":"normal","bucket":3,"tags":["EXTERNAL"],"days_waiting":3,"urgency":"normal","followed_up":false,"cross_reference_status":"new","is_internal":false,"has_attachment":false,"is_time_sensitive":false,"has_contract_language":false,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

push "LSU vs Texas" \
'{"from_address":"CampbellJ@claycorp.com","from_name":"J. Campbell","subject":"LSU vs Texas","thread_subject":"LSU vs Texas","body_preview":"Banter thread with Campbell about the upcoming LSU vs Texas game. No action required.","received_at":"2026-05-13T21:42:00Z","status":"read","importance":"normal","bucket":3,"tags":["INTERNAL"],"days_waiting":2,"urgency":"normal","followed_up":false,"cross_reference_status":"new","is_internal":true,"has_attachment":false,"is_time_sensitive":false,"has_contract_language":false,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

push "Project Solis — R&D Setpoint Adjustment" \
'{"from_address":"RenkenR@claycorp.com","from_name":"Ryan Renken","subject":"Project Solis R and D Setpoint Adjustment","thread_subject":"Project Solis R and D Setpoint Adjustment","body_preview":"Renken analyzing RTU/AHU reduction tradeoff vs tonnage increase. Ryan replied twice May 13. Thread active but Ryan already engaged.","received_at":"2026-05-13T21:43:00Z","status":"read","importance":"normal","bucket":3,"tags":["INTERNAL"],"days_waiting":2,"urgency":"normal","followed_up":false,"cross_reference_status":"new","is_internal":true,"has_attachment":false,"is_time_sensitive":false,"has_contract_language":false,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

push "Project Solis — Energy Recovery AHU-18 VE" \
'{"from_address":"RenkenR@Claycorp.com","from_name":"Ryan Renken","subject":"Project Solis Energy Recovery for AHU-18 and VE Pricing","thread_subject":"Project Solis Energy Recovery for AHU-18 and VE Pricing","body_preview":"Renken forwarded AHU-18 energy recovery cost info to Ryan as background context. Will engage NDBS for VE ideas. Informational.","received_at":"2026-05-14T14:46:00Z","status":"read","importance":"normal","bucket":3,"tags":["INTERNAL"],"days_waiting":1,"urgency":"normal","followed_up":false,"cross_reference_status":"new","is_internal":true,"has_attachment":false,"is_time_sensitive":false,"has_contract_language":false,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

push "Solis NG HVAC VE Convo" \
'{"from_address":"Bill.Huie@stantec.com","from_name":"Bill Huie","subject":"Solis NG HVAC VE Convo","thread_subject":"Solis NG HVAC VE Convo","body_preview":"Huie asking Ryan to forward HVAC VE direction to Erica. Ryan forwarded to Huie 16:28. VE mech direction needs to be memorialized.","received_at":"2026-05-14T16:08:00Z","status":"read","importance":"normal","bucket":3,"tags":["EXTERNAL"],"days_waiting":1,"urgency":"normal","followed_up":false,"cross_reference_status":"new","is_internal":false,"has_attachment":false,"is_time_sensitive":false,"has_contract_language":false,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

push "April 2026 Travel" \
'{"from_address":"GoodwinL@claycorp.com","from_name":"Laura Goodwin","subject":"April 2026 Travel","thread_subject":"April 2026 Travel","body_preview":"Accounting returning April travel expense document to Ryan and Tinney. Admin/process item, review expense report when time allows.","received_at":"2026-05-14T17:18:00Z","status":"read","importance":"normal","bucket":3,"tags":["INTERNAL"],"days_waiting":1,"urgency":"normal","followed_up":false,"cross_reference_status":"new","is_internal":true,"has_attachment":false,"is_time_sensitive":false,"has_contract_language":false,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

echo '── BUCKET 4 — DOCUMENTS (4) ──────────'

push "109160 001 001 LJC DocuSign" \
'{"from_address":"echosign@echosign.com","from_name":"DocuSign","subject":"109160 001 001 The Lamar Johnson Collaborative Inc","thread_subject":"109160 001 001 The Lamar Johnson Collaborative Inc","body_preview":"DocuSign COMPLETED LJC subcontract 109160-001-001. Revised Exhibit B, all parties signed. Archive.","received_at":"2026-05-14T19:53:00Z","status":"done","importance":"normal","bucket":4,"tags":["CONTRACT_LANGUAGE","HAS_ATTACHMENT","EXTERNAL"],"days_waiting":1,"urgency":"normal","followed_up":false,"cross_reference_status":"new","is_internal":false,"has_attachment":true,"is_time_sensitive":false,"has_contract_language":true,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

push "109160 001 002 LJC DocuSign" \
'{"from_address":"echosign@echosign.com","from_name":"DocuSign","subject":"109160 001 002 The Lamar Johnson Collaborative Inc","thread_subject":"109160 001 002 The Lamar Johnson Collaborative Inc","body_preview":"DocuSign COMPLETED LJC subcontract 109160-001-002. Second fully executed LJC sub contract. Archive.","received_at":"2026-05-14T19:51:00Z","status":"done","importance":"normal","bucket":4,"tags":["CONTRACT_LANGUAGE","HAS_ATTACHMENT","EXTERNAL"],"days_waiting":1,"urgency":"normal","followed_up":false,"cross_reference_status":"new","is_internal":false,"has_attachment":true,"is_time_sensitive":false,"has_contract_language":true,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

push "Solis Schedule" \
'{"from_address":"TinneyC@claycorp.com","from_name":"Chris Tinney","subject":"Solis Schedule","thread_subject":"Solis Schedule","body_preview":"Tinney distributed Solis project schedule with PM activity IDs. Informational, schedule review implied.","received_at":"2026-05-13T21:26:00Z","status":"read","importance":"normal","bucket":4,"tags":["INTERNAL","HAS_ATTACHMENT"],"days_waiting":2,"urgency":"normal","followed_up":false,"cross_reference_status":"new","is_internal":true,"has_attachment":true,"is_time_sensitive":false,"has_contract_language":false,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

push "CS Waterproofing Proposal Solis" \
'{"from_address":"proposals@concretestrategies.com","from_name":"Concrete Strategies","subject":"CS Waterproofing Proposal Solis","thread_subject":"CS Waterproofing Proposal Solis","body_preview":"Concrete Strategies submitted waterproofing scope proposal for Solis. Needs review and incorporation into GMP or pushback on scope and pricing.","received_at":"2026-05-14T21:00:00Z","status":"review_needed","importance":"normal","bucket":4,"tags":["INTERNAL","HAS_ATTACHMENT"],"days_waiting":0,"urgency":"normal","followed_up":false,"cross_reference_status":"new","is_internal":true,"has_attachment":true,"is_time_sensitive":false,"has_contract_language":false,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

echo '── BUCKET 5 — PENDING INVITES (1) ──────────'

push "Talk Talk — Availability Poll" \
'{"from_address":"dominic.wood@stantec.com","from_name":"Dominic Wood","subject":"Talk Talk Availability Poll","thread_subject":"Talk Talk Availability Poll","body_preview":"Dominic Wood sent scheduling poll for a Talk Talk coordination call. Needs availability input from Ryan to confirm the meeting time.","received_at":"2026-05-14T22:00:00Z","status":"pending_response","importance":"normal","bucket":5,"tags":["EXTERNAL"],"days_waiting":0,"urgency":"normal","followed_up":false,"cross_reference_status":"new","is_internal":false,"has_attachment":false,"is_time_sensitive":false,"has_contract_language":false,"thread_participant_count":1,"last_report_date":"2026-05-15","is_flagged":false}'

echo ''
echo '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
echo "  SUCCESS: $SUCCESS / 24"
echo "  FAILED:  $FAIL / 24"
echo '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
