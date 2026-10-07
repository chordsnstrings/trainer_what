-- Owner approved immediate policy publication and signup on 7 October 2026.
-- Business identity/contact details and lawyer review are explicitly deferred.
-- Existing production gates, consent checks and published versions are preserved.
-- Fresh databases have no operator and remain under their ordinary setup flow.
DO $release$
DECLARE
 publisher uuid := 'b5d8b077-5255-4bc1-bd64-cc46a3493390';
 document record;
 document_id uuid;
 next_version integer;
 settings_revision integer;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM users WHERE platform_role='admin') THEN RETURN; END IF;
 IF EXISTS (SELECT 1 FROM admin_operations_audit WHERE action='legal.release_published' AND subject_id='uae-2026-10-07') THEN RETURN; END IF;

 -- Attribution to an unprivileged, non-login release identity, not to an admin
 -- who did not click Publish. No memberships or platform role are granted.
 INSERT INTO users(id,email,name,password_hash,email_verified,platform_role)
 VALUES(publisher,'legal-release-20261007@system.invalid','Policy release automation','disabled-release-identity',false,'none');

 FOR document IN SELECT * FROM (VALUES
('terms','Terms of service',$policy_terms$Policy edition: 7 October 2026. The effective date appears with the published version.

1. Who we are and what these terms cover

In these terms, “trainsyou”, “we” and “us” mean the operator of trainsyou.com; “trainer” means the independent coach whose service you choose; and “you” means the account holder. Use the Support page in your account for questions about the service.

These terms cover trainsyou.com, trainer websites hosted on the platform, and the trainsyou web app. The Privacy Policy explains personal-data use. The Digital Coaching Disclosure explains AI, exercise, nutrition and voice features. Your trainer’s offer and the order confirmation specify the service you buy. Additional trainer terms must be available before purchase and cannot reduce your mandatory rights or our responsibilities under these terms.

2. Accounts and eligibility

You must be at least 18 and legally able to enter a contract. Give accurate information, keep your sign-in details private and tell us promptly about unauthorised access. Do not share accounts, impersonate someone or create an account for another adult without their authority. Trainers must have authority to act for any business they register.

Account creation does not authorise health-data processing, marketing, wearable access, voice cloning or publication of a person’s photographs. We request the permissions relevant to each activity separately. Declining an optional permission does not stop you using unrelated features.

3. The platform and your trainer

trainsyou provides the technology for trainers to teach their AI coaching methods, publish a website and deliver services to clients. Trainers remain responsible for their qualifications, lawful professional scope, representations, content, programme design and the services they agree to provide. AI features do not turn an independent trainer into a licensed healthcare professional.

We are responsible for operating the platform and for our own representations, payment administration and other obligations under applicable law. A trainer’s independence does not remove any duty the law places on us as a digital platform or supplier.

A subscription includes only the services shown in its offer. Human review, one-to-one appointments, nutrition and guided voice are included only when expressly stated. An AI conversation is not a live conversation with the trainer. A profile, badge or presence on the platform is not a government endorsement.

4. Prices, subscriptions and payment

Before payment, the offer must identify the supplier, included services, total price, currency, applicable VAT, billing frequency, programme duration and any renewal or cancellation conditions. Do not proceed if those details are unclear. We do not add optional services or convert a free account into a paid subscription without an order you authorise.

A recurring subscription renews at the interval accepted at checkout until cancelled. A fixed-duration programme follows its stated end date and renews only if renewal was expressly agreed. Discounts and trials must state what happens when they end. Price changes are communicated before they apply and never rewrite a completed purchase. Where renewed agreement is required, we obtain it; you may cancel before the next renewal.

Where enabled, payment providers process card payments and banks or payment providers handle trainer payouts. We do not receive your complete card security credentials. A failed payment may interrupt paid access; it does not authorise an undisclosed fee. Save your order confirmation and invoice. Consumer information and invoices remain subject to applicable UAE language requirements.

5. Cancellation, refunds and bookings

Cancel renewal using your account’s subscription controls. Cancellation normally takes effect at the end of the paid period, and the account shows when access ends. Deleting the app, signing out or stopping exercise does not itself cancel a subscription. If a cancellation control fails, send a request through the Support page in your account and keep the request confirmation; we will assess the request using the time it reached us.

Unused time is not automatically refunded merely because you stop using a correctly supplied service. This does not restrict a refund, repeat performance, price reduction or other remedy required by UAE law. We will correct duplicate charges and investigate unauthorised payments, material misdescription, defective service and paid services that were not supplied. No “no refunds” label overrides those rights.

Send a refund request through the available billing/support channel or through the Support page in your account, with your order reference and reason. Do not send full card details. We will explain the decision and calculation. Approved refunds normally go to the original payment method; bank processing times vary. Your right to approach your payment provider or a competent authority is unaffected.

Appointment cancellation, rescheduling and no-show conditions must be shown before booking. If the trainer cancels, you may choose an agreed replacement or a refund for the undelivered appointment. Any deduction must have been disclosed, be lawful and reflect the relevant circumstances. Credits or replacement services are not imposed instead of a refund you are legally entitled to receive.

6. Trainer responsibilities and commercial terms

Trainers must maintain the licences, qualifications and permissions their actual work requires, describe them accurately, and work within their competence. They must not diagnose, prescribe, provide regulated treatment or offer clinical nutrition without the authorisation required for that activity. They must respond appropriately to safety concerns, correct misleading material and arrange reasonable continuity for services already sold.

Joining, setting up the trainer workspace and teaching the trainer’s AI carry no upfront platform charge. Buying a custom domain is optional and requires a separate purchase. Platform commission, payment fees, subscriber-serving AI charges, payout arrangements and taxes are governed by the fee schedule presented to the trainer. A change applies prospectively after notice and any required agreement. We do not promise earnings, audience growth or a particular payout date where verification, a bank, a lawful hold or a payment dispute prevents settlement.

Trainers must keep client information confidential, use it only for agreed and lawful purposes, restrict staff access and assist with privacy requests. They may not copy client data into unrelated AI tools, sell it or use it for unrelated advertising. An arrangement in which we process data on a trainer’s instructions may require a separate data-processing agreement; these public terms do not replace it.

7. Content, photographs, voice and intellectual property

You retain your rights in material you provide. You grant us a non-exclusive licence to host, process, format, display and deliver it as needed to provide the services you request. This does not give us ownership of a trainer’s methods or a right to sell private client information.

Upload only material you own or are authorised to use. Obtain specific permission before publishing a client’s name, testimonial, before-and-after photograph or other identifying information. Permission to receive coaching is not permission to feature in advertising. Transformation claims must be accurate, disclose material context and avoid guaranteed or manipulated results. Tell us about an infringement or withdrawn permission promptly so future use can be addressed.

Creating or using a cloned voice requires the voice owner’s explicit permission and any necessary provider authorisation. Do not imitate another person without permission or present generated speech as something they personally said. Platform music, designs and other supplied assets are licensed only for the uses made available in the product; access or download alone does not grant resale, redistribution or commercial music rights.

8. Acceptable use

Do not use the service for unlawful conduct, harassment, discrimination, sexual exploitation, threats, fraud, misleading health claims or infringement of another person’s rights. Do not upload another person’s confidential information without authority, evade security controls, access another workspace, distribute malware, harvest personal data or disrupt the service. Do not sell, prescribe or promote unlawful or unlicensed products through a coaching account.

We may investigate reports and restrict content or accounts when reasonably necessary to protect people, comply with law or address a material breach. Where appropriate, we explain the reason and provide a way to challenge the decision. Urgent action may precede notice where notice would create a safety or security risk, prejudice an investigation or breach the law. Restrictions do not extinguish valid refund or privacy rights.

9. Safety, availability and responsibility

Exercise involves risk. Use suitable equipment and surroundings, follow your own limits and the Digital Coaching Disclosure, and seek qualified help when needed. Neither AI output nor acceptance of these terms is a medical clearance or a waiver of another party’s negligence.

We use reasonable care and skill in providing the platform. We cannot guarantee uninterrupted availability, an error-free AI answer or a fitness outcome. We remain responsible for losses the law makes us responsible for. Neither party is liable for a loss that is not legally attributable to its conduct. Nothing excludes liability for fraud, deliberate misconduct, gross negligence, death or personal injury where exclusion is unlawful, or any other liability or consumer remedy that cannot lawfully be excluded. You are not required to indemnify us for our own fault.

For a trainer’s commercial account, responsibility for third-party claims arising from that trainer’s unlawful content, infringement or material breach is limited to loss legally attributable to that conduct. The trainer must receive prompt notice and a fair opportunity to respond; no settlement admitting their liability or imposing obligations on them may be made without their agreement.

10. Closing an account and changes

You may stop using the platform and request account closure. Cancellation of paid services, outstanding amounts, refunds, data export and erasure are handled separately as described above and in the Privacy Policy. Records that must lawfully be retained are not deleted merely because an account closes. Ending a trainer workspace must address existing clients and outstanding services; transferring it does not silently expand permission to use client data.

We give reasonable notice of material changes, explain when they take effect and seek renewed acceptance where required. We do not use continued browsing to infer a new health-data or marketing consent. If a change materially reduces a paid service, your applicable cancellation and refund rights remain available.

11. Complaints, governing law and language

Send a request through the Support page in your account with the account or order reference, what happened and the remedy requested. We will investigate and provide a reasoned response. You may also complain to the competent UAE consumer-protection authority or data-protection regulator and seek judicial relief. You need not waive those rights or agree to compulsory arbitration to use the service.

These terms are governed by the applicable laws of the United Arab Emirates and the Emirate of Dubai. Disputes may be brought before the competent UAE courts, subject to mandatory jurisdiction and consumer protections. No clause overrides a law that applies because of your location, a regulated activity or a relevant free-zone regime.

These terms are issued in English. Mandatory UAE rules on language, consumer information and interpretation prevail. If a provision cannot lawfully be enforced, the remaining provisions continue so far as the law permits.$policy_terms$),
('privacy','Privacy policy',$policy_privacy$Policy edition: 7 October 2026. The effective date appears with the published version.

1. Who handles your information

This policy explains how the operator of trainsyou.com handles personal information through the website and web app. For privacy questions or requests, use the Privacy controls or select Privacy on the Support page in your account.

We determine how information is used to run accounts, secure the platform, administer payments, provide support and manage our own communications. Your chosen trainer determines how to use information for their independent coaching practice. We also provide tools that process information on a trainer’s instructions. The legal responsibilities of each party depend on the activity, not simply on these labels. Contact either party if you are unsure who should handle a request; we will direct it appropriately.

This policy is intended to address applicable UAE data-protection requirements. The federal Personal Data Protection Law applies where its scope covers the processing. Separate health-sector or free-zone rules may apply to particular activities. Describing a service as fitness or AI does not exempt regulated health information from the law.

2. Information we receive

Account information includes your name, email, sign-in and verification information, account preferences, subscriptions and support requests. Trainer information may include a biography, qualifications, business details, coaching material, website content, fee arrangements and payout or verification information.

Coaching information may include age, goals, exercise experience, equipment, activity records, progress, measurements, injuries or limitations you choose to disclose, and messages with your trainer or their AI. Where enabled and separately authorised, it may also include nutrition preferences, allergies, food entries or photographs, wearable activity, uploaded files, voice requests and recordings. Some of this is sensitive personal information.

We receive transaction and payment-status information needed to administer purchases and refunds. Payment providers collect card or banking information through their own authorised processes. We also receive technical information such as device/browser details, IP addresses, timestamps, errors and security or audit records. Optional attribution records can link a visit or referral to a signup or purchase when you permit that measurement.

Do not submit another person’s information without authority. Avoid adding unnecessary identification documents, medical records or other sensitive details to ordinary chat or support messages.

3. Purposes and grounds for use

We use information to create and administer your account; deliver the coaching or other services you request; generate and review authorised AI responses; manage subscriptions, refunds and trainer payments; investigate problems and abuse; meet legal obligations; and establish, exercise or defend legal claims.

We use contractual necessity or another applicable statutory ground where it genuinely applies. Where processing relies on consent, we request a clear choice for the stated purpose and record it. We do not treat opening an account, accepting terms or remaining silent as blanket consent to health-data processing, optional tracking, marketing, wearable connections or voice cloning.

You may withdraw consent for future processing through the relevant account controls or by contacting us. Withdrawal does not make earlier lawful processing unlawful. A feature may stop if it depends on the information withdrawn; unrelated features remain available. Legal retention duties may still require limited records to be kept.

4. AI and human access

A frontier model may process information relevant to a coaching request, together with your trainer’s methods, to generate workouts, nutrition guidance, summaries or conversation. Voice services may turn text into speech or transcribe an explicit voice request. These are automated processes; a familiar voice is not evidence that the trainer is personally present.

Your trainer and authorised members of their team can access information needed to provide your service. Authorised platform personnel may access relevant records for support, safety, security, administration or a legal obligation. Access is restricted by role and purpose. We do not promise that every message or generated plan is reviewed by a person.

Permission to deliver your coaching does not authorise sale of your private records or unrestricted use to train a general-purpose model. Any materially different model-training or research use requires its own lawful basis, notice and any necessary separate consent. Provider terms, retention and training settings must support the purpose disclosed to you. Ask us for information about the providers involved in a particular feature.

Where an automated decision has legal or similarly significant effects and applicable law gives you that right, you may request an explanation, challenge the decision and ask for human review. Contact us rather than relying on an AI response to decide a complaint or privacy request.

5. Sharing and service providers

We share information only as needed for the purposes described here, with the trainer you select, their authorised team, and providers supporting hosting, storage, AI, voice, transactional communications, payments, domains, security or integrations you enable. The information shared depends on the feature; a music-generation service does not need your private coaching history to create shared instrumental tracks.

A payment provider, bank or connected wearable service may also act independently under its own privacy notice. We may disclose information when a valid legal obligation requires it, to protect rights or safety where the law permits, or during a business transfer subject to appropriate safeguards and notice. We do not sell personal data.

Trainers may publish your testimonial, identifiable progress photograph or transformation story only with specific permission for that publication. A private upload for coaching is not permission for public display. Once material is lawfully public, third parties may copy it; withdrawal stops uses we control but cannot guarantee removal of every third-party copy.

6. International processing

We may use service providers that process personal information outside the UAE. The information involved depends on the service you use. International processing is subject to the applicable legal requirements and safeguards; this policy does not represent that all processing takes place within the UAE.

Transfers must have a permitted basis and safeguards under the law that applies to the information. Consent does not override a statutory localisation restriction. If UAE health-data rules require a local copy, authority permission, a specific exemption or another condition, the relevant processing must meet that condition before it takes place. This policy is not an authorisation to export regulated health records. A transfer cannot be made lawful merely by selecting a checkbox.

7. Storage, retention and deletion

We retain account and service information for as long as it is needed to provide the service and for an additional period only where a documented operational or legal need justifies it. The criteria include the account’s status, outstanding services or refunds, an unresolved complaint, a security investigation, applicable financial or tax records and the time needed to establish or defend a legal claim.

A privacy request is assessed by category rather than by deleting every record at once. Information no longer needed is deleted or anonymised where appropriate. Necessary financial records, consent evidence and limited audit references may remain under restricted use. We will explain a relevant retention reason when responding to a request, unless the law prevents that disclosure.

Deletion from active application records, deletion by service providers and expiry of backup copies are separate steps. We track the relevant follow-up and do not describe a request as complete while required provider or backup action remains outstanding. Backup copies are restricted to recovery and legitimate operational needs; a restoration must respect recorded erasure requests. We do not promise immediate or simultaneous deletion from every system.

Your installed web app may keep drafts, session progress, preferences and downloaded media on your device. Use a private device, sign out on shared devices and clear local application storage if you no longer want those copies. Closing an account does not remotely erase every file you have downloaded.

8. Your choices and rights

Subject to the applicable law and its exceptions, you may request information about processing, access to your personal data, correction, erasure, restriction or cessation of processing, and a copy or transfer of eligible data. You may withdraw consent and object to qualifying automated decisions. You may use either the available privacy controls or the Support page to raise a request.

Use the privacy and account controls available in the app or send a request through the Support page in your account. We may ask for proportionate verification to prevent disclosure to the wrong person. We will respond within the legally applicable period and explain a lawful refusal, limitation or need for additional time. An ordinary request will not attract an undisclosed charge. You may contact the competent UAE data-protection authority and use any available complaint or judicial procedure.

Tell your trainer as well if information in their independent records needs correction or deletion. Where we process it on their instructions, we assist with the request within our responsibilities. We cannot erase records held independently by an unrelated provider simply by removing them from our app.

9. Cookies, local storage and communications

Essential cookies and browser storage support sign-in, security, language and the service you request. Optional acquisition measurement operates on a separate permission and records such information as referral source and conversion events. Its browser identifiers may last up to 180 days. Refusing optional measurement does not prevent account creation. You may change the available preference or clear browser storage; this may sign you out or remove unsynchronised drafts.

Operational messages concern account access, security, purchases or services you requested. Promotional communications require the permission applicable to that channel and can be stopped using the unsubscribe or preference controls or by contacting us. Stopping promotions does not suppress a necessary security or billing notice. We do not add advertising trackers or a new marketing purpose under the label of an essential service.

10. Security, children and policy changes

We apply reasonable technical and organisational measures, including access restrictions, secure connections and controls over administrative credentials. No service can guarantee that an incident will never occur. We investigate suspected incidents and notify affected people and authorities when the applicable law requires it. Report suspected account or data misuse through the Support page in your account; do not include unnecessary sensitive records in the report.

The service is intended for adults aged 18 and over. It is not offered as a children's service. Contact us if a child’s information has been submitted so that we can assess and address it.

This policy’s effective date and version identify the notice currently in use. Material changes will be communicated appropriately. A changed notice does not retrospectively create consent or authorise a new purpose that requires a separate choice.$policy_privacy$),
('ai-disclosure','Digital coaching and health disclosure',$policy_ai_disclosure$Policy edition: 7 October 2026. The effective date appears with the published version.

1. What digital coaching means

trainsyou uses a frontier model, guided by material and instructions supplied by your trainer, to generate parts of your coaching experience. This may include workouts, adjustments, nutrition suggestions, summaries and conversation. Generated material can be incomplete, outdated or wrong, even when it sounds confident or resembles your trainer’s usual advice. The technology does not guarantee a result or reproduce every judgement your trainer would make in person.

AI delivery, human review and live coaching are different services. Your offer explains which you receive. Do not assume that a trainer has personally checked an answer or is monitoring a workout unless the service expressly says so. Automated safeguards reduce some risks; they cannot assess every person or situation.

2. Fitness support, not medical care

The platform provides fitness and general wellbeing support. It does not diagnose illness, prescribe medicines, provide emergency care or replace an examination by a qualified professional. A trainer may provide a regulated service only if appropriately authorised to do so; the use of AI does not expand that authorisation.

Give accurate information about relevant limitations and update it when circumstances change. Seek appropriate clinical advice before following a programme when your health, an injury, surgery, pregnancy, medication or another condition makes that necessary. You do not have to upload medical records to justify asking for help or stopping a workout.

Stop exercise if you experience concerning pain, faintness, unusual breathlessness or other symptoms that make continuing unsafe. Seek urgent help for a suspected emergency. Contact the appropriate local emergency service; do not wait for an app message or a trainer reply. A chat, wearable reading or automated safety flag is not an emergency-monitoring service.

3. Workouts and guided sessions

Review the exercise, load, repetitions, time and rest instructions before starting. Use suitable equipment and a safe environment. Change or stop an exercise that is unsuitable for your experience, surroundings or present condition. Ask a qualified trainer about an unfamiliar movement or equipment setup.

A timed cue does not prove that you completed a repetition or set. Guided sessions use the progress you confirm and the controls available on your device. The system cannot reliably observe your form, judge the weight you lifted or determine how fatigued you are. Device locks, headphones, connectivity and background-audio restrictions can interrupt cues. Pause the workout when instructions are unclear; do not hurry to keep up with a timer or voice.

Instrumental music supports the experience but is not a safety signal. Keep the volume at a level that lets you remain aware of your surroundings. Do not use guided workouts while driving or performing an activity where distraction would be unsafe.

4. Nutrition and connected information

Where included in your plan, nutrition tools can suggest meals, recipes, portions and shopping quantities. Calorie, nutrient, barcode and photograph estimates are approximate and depend on the information supplied. Confirm food identity, portion size, labels and ingredients yourself. An AI answer or product database cannot guarantee that food is free from an allergen or suitable for a medical condition.

Do not use general meal suggestions as treatment for a disease, an eating disorder or a condition needing a prescribed diet. Seek an appropriately licensed clinician or dietitian for medical nutrition. Trainers must remain within their lawful professional scope. Recommendations are not a reason to start, stop or change medication or use an unapproved supplement or substance.

Wearables and imported records may be incomplete, delayed or inaccurate. A missing or normal-looking reading does not establish that exercise is safe. Connect only your own account and use the integration’s permission and disconnection controls.

5. Voice and recordings

A synthetic voice may sound like a person who authorised its use. It remains generated speech and does not mean that person is speaking live, personally endorsing that particular answer or listening to the session. We distinguish generated coaching from an actual human appointment.

Microphone or audio processing must be tied to an explicit voice feature you choose. This is not continuous supervision of your environment. Gym noise or another person’s voice is not reliable confirmation of your workout progress. Do not record bystanders without the permission required by law. Only a person with the necessary rights may authorise a trainer voice clone.

6. Your permissions and review options

Creating an account or accepting the Terms does not grant every optional permission. Coaching information, nutrition features, connected devices, voice and public testimonials use the permissions applicable to their purpose. Review the Privacy Policy for the information involved, service providers, international processing and your rights. You can withdraw relevant consent; a dependent feature may then stop working.

Report an unsafe, inaccurate or unsuitable response to your trainer or to the Support page in your account. Include enough information to identify the session without sending unnecessary sensitive records. You can ask for human review; urgent health issues should go to a qualified professional or emergency service. Do not repeat an exercise to reproduce a dangerous response.

Fitness progress varies. Before-and-after photographs and testimonials describe individual experiences, not typical or guaranteed results. These disclosures explain the limits of the service; they do not waive liability for negligence, remove a consumer remedy or override a legal duty owed by trainsyou or your trainer.$policy_ai_disclosure$)
 ) AS policies(key,title,content)
 LOOP
  PERFORM pg_advisory_xact_lock(hashtext('document:legal:' || document.key));
  SELECT coalesce(max(version),0)+1 INTO next_version FROM admin_documents WHERE kind='legal' AND key=document.key;
  document_id := gen_random_uuid();
  INSERT INTO admin_documents(id,kind,key,version,title,content,status,effective_at,created_by,published_by,published_at)
  VALUES(document_id,'legal',document.key,next_version,document.title,document.content,'published',now(),publisher,publisher,now());
  INSERT INTO admin_operations_audit(id,actor_id,action,subject_id,data)
  VALUES(gen_random_uuid(),publisher,'document.published',document_id::text,jsonb_build_object('kind','legal','key',document.key,'version',next_version,'source','owner-authorised release 2026-10-07','lawyerReview','pending'));
 END LOOP;

 INSERT INTO platform_settings(integration_id,revision,enabled,settings_values,updated_by)
 VALUES('application',1,true,'{"LEGAL_APPROVED":"true"}'::jsonb,publisher)
 ON CONFLICT (integration_id) DO UPDATE SET
  revision=platform_settings.revision+1,
  settings_values=platform_settings.settings_values || '{"LEGAL_APPROVED":"true"}'::jsonb,
  updated_by=publisher,updated_at=now()
 RETURNING revision INTO settings_revision;
 INSERT INTO platform_settings_audit(id,integration_id,revision,action,actor_id,changed_fields,result)
 VALUES(gen_random_uuid(),'application',settings_revision,'saved',publisher,'["LEGAL_APPROVED"]'::jsonb,'validated');
 INSERT INTO admin_operations_audit(id,actor_id,action,subject_id,data)
 VALUES(gen_random_uuid(),publisher,'legal.release_published','uae-2026-10-07',jsonb_build_object('ownerApproved',true,'lawyerReview','pending','businessDetails','deferred by owner','userConsent','explicit; unchanged'));
END;
$release$;
