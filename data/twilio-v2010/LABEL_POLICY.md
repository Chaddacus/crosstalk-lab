# Label policy (written before any query)

Every item has one query and one gold label. The gold label is one Twilio v2010 `operationId`, or `none_of_these`.

## Rules

1. **First call.** Gold is the first operation a competent engineer would call to do what the request asks, given only what the request says.
2. **Identified object → Fetch / Update / Delete.** When the request identifies a single object by its SID (or another key that sits in the path, such as a country code), use the operation on that object. SIDs in queries are obviously fake placeholders such as `CAxxxx0042`.
3. **Set or filter → List.** A request for many objects, or for objects matching a filter (date, status, number type), uses the List operation.
4. **Most specific path.** When the request names a parent resource (a call, a conference, a recording, a SIP domain), use the nested operation under that parent. Example: "the recordings of call CAxxxx2020" → `ListCallRecording`, not `ListRecording`.
5. **Spec words settle boundaries.** Use the spec's own descriptions. Examples:
   - `UpdateCall` "Initiates a call redirect or terminates a call". Hanging up or redirecting a live call is `UpdateCall`.
   - `DeleteCall` deletes the call *record* from the account logs. Only requests to remove the record or log entry are `DeleteCall`.
   - `UpdateMember` dequeues a member and sends its call to a TwiML URL.
   - `UpdateMessage` redacts a message body or cancels a not-yet-sent message.
   - `DeleteParticipant` kicks a participant; `UpdateParticipant` mutes, holds or changes a participant; ending a whole conference is `UpdateConference`.
6. **Numbers.**
   - Searching for numbers to buy is `ListAvailablePhoneNumber<Type>` when a type is named (Local, Mobile, TollFree, National, Voip, SharedCost, MachineToMachine).
   - Buying a specific number of a named type is `CreateIncomingPhoneNumber<Type>` (Local, Mobile, TollFree). Buying by area code, or a specific number with no type named, is `CreateIncomingPhoneNumber`.
   - Listing owned numbers of a named type is `ListIncomingPhoneNumber<Type>`; all owned numbers is `ListIncomingPhoneNumber`.
7. **Usage.** A named period with its own subresource (Today, Yesterday, ThisMonth, LastMonth, AllTime, Daily, Monthly, Yearly) uses that subresource. A custom date range uses `ListUsageRecord`.
8. **Keys.** "API key" means `Keys`. "Signing key" means `SigningKeys`.
9. **SIP credential mappings.** Authenticating *calls* on a domain uses `SipAuthCalls…Mapping`. Authenticating *registrations* (phones registering to the domain) uses `SipAuthRegistrations…Mapping`. A mapping request that names neither uses the domain-level `SipCredentialListMapping` or `SipIpAccessControlListMapping`.
10. **Transcriptions.** Live transcription on an in-progress call uses `CreateRealtimeTranscription` / `UpdateRealtimeTranscription`. Transcriptions of a named recording use `…RecordingTranscription`. Account-wide transcription resources use `…Transcription`.
11. **One gold.** If two operations are equally valid under these rules, rewrite the query or drop it.
12. **`none_of_these`** when no operation in this API fulfils the request: how-to and documentation questions, other Twilio products that are not in this API (for example Verify, Studio, Flex, TaskRouter, Conversations, Lookup, Messaging Services, Video, SendGrid), other vendors' actions, small talk, and requests that need no API call.

## Privacy

No real names, phone numbers, emails or SIDs. Phone numbers use the `555-01xx` fictional range. Emails use `example.com`. IP addresses use documentation ranges (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`). `npm run lint:data` and `npm test` enforce this.

## Provenance

Queries are synthetic. They were drafted by an AI agent (Claude) for this project, following this policy, in six personas: support agent, telecom admin, developer, billing analyst, contact-center supervisor, security admin. A human review of a sample is pending.
