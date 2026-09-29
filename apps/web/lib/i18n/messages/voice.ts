import { defineMessages } from "../core";

/**
 * The voice-led session: preparing it, the runner's controls and status,
 * spoken replies and consent. The spoken lines themselves are the trainer's
 * script and stay in the script's language.
 */
export default defineMessages(
  {
    loading: "Loading your session…",
    eyebrow: "VOICE-LED SESSION",
    fallbackTitle: "Your workout, guided",
    aheadOn: "Get your trainer’s voice ready before {date}. ",
    aheadDay: "Get your trainer’s voice ready before the day. ",
    intro:
      "Your trainer’s session plan, one step at a time. Say or tap “pain” at any moment and the session stops and your trainer is told.",
    started: "This session has started.",
    openRunner: "Open the voice-led session",
    notOpen: "This planned session is no longer open.",
    prepareTitle: "Prepare this session",
    staleText:
      "Your trainer changed this workout. Prepare the session again so it follows the current plan.",
    held: "Training is paused for your trainer’s review.",
    voiceText:
      "Your trainer’s approved voice will guide you through every exercise, set and rest. Audio is prepared ahead of time.",
    consentVoice: "I want this session read in my trainer’s approved voice.",
    prepareVoice: "Prepare voice-led session",
    useText: "Use text guidance",
    prepareText: "Prepare text-guided session",
    startText: "Start text-guided session",
    trainerVoice: "Your trainer’s voice",
    textSession: "Text-guided session",
    preparingAhead:
      "Your trainer’s voice is being prepared. You can leave this page; it carries on in the background.",
    readyAhead:
      "Ready. Start the workout when you are, and the session will be waiting.",
    switchVoice: "Switch to your trainer’s voice",
    startWithVoice: "Start this workout with the voice-led session",
    openLog: "Open the workout log",
    backCalendar: "Back to your training calendar",
    badgePreparing: "Preparing {progress}",
    badgePaused: "Voice paused",
    badgeReady: "Voice ready",
    badgeText: "Text",
    reason_MEMBERSHIP_REQUIRED: "An active membership is required.",
    reason_TRAINING_HELD:
      "Training is paused for your trainer’s review. Resume after your trainer releases the hold.",
    reason_VOICE_MEMBERSHIP:
      "Your membership does not include your trainer’s voice. The text-guided session is included.",
    reason_VOICE_CONTRACT:
      "Trainer voice is not switched on for this platform yet.",
    reason_VOICE_NOT_VERIFIED:
      "Your trainer’s voice is awaiting verification or permission.",
    reason_VOICE_BUDGET:
      "Today’s voice limit for this workspace has been reached. The text-guided session continues.",
    reason_PLAYBACK_CONSENT:
      "Agree to hear your trainer’s approved voice to use the voice-led session.",
    reason_VOICE_UNAVAILABLE: "Your trainer’s voice is no longer available.",
    reason_VOICE_SCRIPT_INVALID:
      "The spoken script no longer matches your workout. Prepare it again.",
    // Runner
    loadFailed:
      "Trainer voice could not be loaded: {reason} The session continues with text.",
    signedOut:
      "Your sign-in ended. Set logs stay on this device and sync after you sign in.",
    savedHere: "Saved on this device. {reason}",
    notAccepted: "A set log was not accepted. Review it on the workout log.",
    stopNow:
      "Stop exercising. Your trainer is being told. If your symptoms are severe or urgent, get local medical help now.",
    stopped:
      "Session stopped and your trainer has been told. If your symptoms are severe or urgent, get local medical help now.",
    painRefused: "{reason} Message your trainer about how you feel.",
    painOffline:
      "You appear to be offline. Stop exercising and contact your trainer; get local medical help if symptoms are severe.",
    micUnavailable:
      "Spoken replies stopped: the microphone or on-device recognition is unavailable. Use the buttons.",
    micPermission:
      "Microphone permission is needed for spoken replies. Use the buttons.",
    agreeFirst: "Agree to transcription first.",
    voiceOff:
      "Your trainer’s voice is off and its stored audio for you was removed. The session continues with text.",
    generating:
      "Your trainer’s voice is being prepared. You can start now; lines that are not ready yet are shown as text.",
    capped:
      "Your trainer’s voice is paused for now. The rest of this session is shown as text.",
    useApproved: "Use my trainer’s approved voice",
    unmute: "Unmute voice",
    mute: "Mute voice",
    stopVoice: "Stop using my trainer’s voice",
    setOf: "Set {set} of {sets}",
    reps: { one: "# rep", other: "# reps" },
    lighter: "(lighter)",
    load: "{load} kg",
    changed:
      "Your trainer changed this workout, so this session stopped. Sets you logged are saved. Prepare the session again to follow the current plan.",
    prepareAgain: "Prepare again",
    startSession: "Start session",
    noMatch: "This session no longer matches your workout.",
    ended: "This voice session has ended. Continue on the workout log.",
    replies: "Session replies",
    done: "Done",
    tooHeavy: "Too heavy",
    tooEasy: "Too easy",
    skip: "Skip",
    repeat: "Repeat",
    resume: "Resume",
    pause: "Pause",
    repsDone: "Reps done",
    logReps: "Log reps",
    painNote: "Pain button pressed during the voice session",
    pain: "Pain — stop now",
    endEarly: "End session without finishing",
    finished: "Workout finished and saved.",
    waiting:
      "Session complete. Your workout will be finished once your set logs sync.",
    complete: "Session complete.",
    tryAgain: "Try again",
    needAttention: {
      one: "# set log needs attention on the workout log.",
      other: "# set logs need attention on the workout log.",
    },
    spokenReplies: "Spoken replies",
    spokenHelp:
      "Say “done”, a number of reps, “too heavy”, “pause” or “pain”. While your trainer’s voice is speaking, replies are not heard: tap a button instead. The buttons always work.",
    listenDevice: "Listen on this device",
    theService: "the speech service",
    theProvider: "the provider",
    sendClips:
      "Send short clips of my replies to {provider} for transcription. This app does not keep the clips; ",
    zeroRetention: "the provider is asked not to keep them either.",
    ownTerms: "{provider} handles them under its own data retention terms.",
    listenService: "Listen with the speech service",
    noSpeech:
      "Spoken replies are not available on this device. Use the buttons.",
    listeningDevice: "Listening on this device.",
    listeningService: "Listening with the speech service.",
    heard: "Heard: {text}.",
    stopListening: "Stop listening",
    withdraw: "Withdraw transcription permission",
    // Runner status line
    status_ready: "Ready to start.",
    status_warmup: "Warming up.",
    status_setup: "{name}: getting ready.",
    status_set: "{name}, set {set} of {sets}: {reps}.",
    status_setLoad: "{name}, set {set} of {sets}: {reps} at {load}.",
    status_rest: {
      one: "Resting: # second left.",
      other: "Resting: # seconds left.",
    },
    status_cooldown: "Cooling down.",
    status_finished: "Session complete.",
    status_paused: "Paused.",
    status_pain: "Stopped. Your trainer has been told.",
    status_member: "Session ended.",
    status_review: "Stopped for your trainer’s review.",
  },
  {
    loading: "جارٍ تحميل جلستك…",
    eyebrow: "جلسة بتوجيه صوتي",
    fallbackTitle: "تمرينك بتوجيه",
    aheadOn: "تجهيز صوت مدربك قبل {date}. ",
    aheadDay: "تجهيز صوت مدربك قبل يوم الجلسة. ",
    intro:
      "خطة جلسة مدربك خطوة بخطوة. عند قول «ألم» أو الضغط عليه في أي لحظة تتوقف الجلسة ويُبلَّغ مدربك.",
    started: "بدأت هذه الجلسة.",
    openRunner: "فتح الجلسة الصوتية",
    notOpen: "هذه الجلسة المخطط لها لم تعد متاحة.",
    prepareTitle: "تجهيز هذه الجلسة",
    staleText:
      "غيّر مدربك هذا التمرين. يُرجى تجهيز الجلسة مرة أخرى لتتبع الخطة الحالية.",
    held: "التدريب متوقف مؤقتًا لمراجعة مدربك.",
    voiceText:
      "سيرشدك صوت مدربك المعتمد في كل تمرين ومجموعة وراحة. يُجهَّز الصوت مسبقًا.",
    consentVoice: "أريد أن تُقرأ هذه الجلسة بصوت مدربي المعتمد.",
    prepareVoice: "تجهيز الجلسة الصوتية",
    useText: "استخدام التوجيه النصي",
    prepareText: "تجهيز جلسة بتوجيه نصي",
    startText: "بدء جلسة بتوجيه نصي",
    trainerVoice: "صوت مدربك",
    textSession: "جلسة بتوجيه نصي",
    preparingAhead:
      "جارٍ تجهيز صوت مدربك. يمكنك مغادرة هذه الصفحة؛ يستمر التجهيز في الخلفية.",
    readyAhead: "كل شيء جاهز. يمكنك بدء التمرين متى شئت، وستكون الجلسة بانتظارك.",
    switchVoice: "التبديل إلى صوت مدربك",
    startWithVoice: "بدء هذا التمرين بالجلسة الصوتية",
    openLog: "فتح سجل التمرين",
    backCalendar: "العودة إلى تقويم التدريب",
    badgePreparing: "جارٍ التجهيز {progress}",
    badgePaused: "الصوت متوقف",
    badgeReady: "الصوت جاهز",
    badgeText: "نص",
    reason_MEMBERSHIP_REQUIRED: "يلزم اشتراك نشط.",
    reason_TRAINING_HELD:
      "التدريب متوقف مؤقتًا لمراجعة مدربك. يمكنك المتابعة بعد أن يرفع مدربك الإيقاف.",
    reason_VOICE_MEMBERSHIP:
      "لا يشمل اشتراكك صوت مدربك. الجلسة بالتوجيه النصي مشمولة.",
    reason_VOICE_CONTRACT: "صوت المدرب غير مفعّل على هذه المنصة بعد.",
    reason_VOICE_NOT_VERIFIED: "صوت مدربك بانتظار التحقق أو الإذن.",
    reason_VOICE_BUDGET:
      "بلغت مساحة التدريب هذه حد الصوت اليومي. تستمر الجلسة بالتوجيه النصي.",
    reason_PLAYBACK_CONSENT:
      "لاستخدام الجلسة الصوتية، يلزم الموافقة على سماع صوت مدربك المعتمد.",
    reason_VOICE_UNAVAILABLE: "صوت مدربك لم يعد متاحًا.",
    reason_VOICE_SCRIPT_INVALID:
      "النص المنطوق لم يعد يطابق تمرينك. يُرجى تجهيزه مرة أخرى.",
    loadFailed: "تعذّر تحميل صوت المدرب: {reason} تستمر الجلسة نصيًا.",
    signedOut:
      "انتهت جلسة تسجيل الدخول. تبقى سجلات المجموعات على هذا الجهاز وتتم مزامنتها بعد تسجيل الدخول.",
    savedHere: "تم الحفظ على هذا الجهاز. {reason}",
    notAccepted: "لم يُقبل أحد سجلات المجموعات. يُرجى مراجعته في سجل التمرين.",
    stopNow:
      "توقّف عن التمرين. جارٍ إبلاغ مدربك. إذا كانت الأعراض شديدة أو عاجلة، فاطلب مساعدة طبية محلية الآن.",
    stopped:
      "توقفت الجلسة وأُبلغ مدربك. إذا كانت الأعراض شديدة أو عاجلة، فاطلب مساعدة طبية محلية الآن.",
    painRefused: "{reason} يُرجى مراسلة مدربك بشأن ما تشعر به.",
    painOffline:
      "يبدو أنك غير متصل. توقّف عن التمرين وتواصل مع مدربك، واطلب مساعدة طبية محلية إذا كانت الأعراض شديدة.",
    micUnavailable:
      "توقفت الردود الصوتية: الميكروفون أو التعرّف على الكلام على الجهاز غير متاح. يُرجى استخدام الأزرار.",
    micPermission: "يلزم إذن الميكروفون للردود الصوتية. يُرجى استخدام الأزرار.",
    agreeFirst: "يُرجى الموافقة على التفريغ النصي أولًا.",
    voiceOff:
      "أُوقف صوت مدربك وحُذف الصوت المخزّن لك. تستمر الجلسة نصيًا.",
    generating:
      "جارٍ تجهيز صوت مدربك. يمكنك البدء الآن؛ تظهر الجمل غير الجاهزة بعد كنص.",
    capped: "صوت مدربك متوقف حاليًا، وتظهر بقية هذه الجلسة كنص.",
    useApproved: "استخدام صوت مدربي المعتمد",
    unmute: "تشغيل الصوت",
    mute: "كتم الصوت",
    stopVoice: "إيقاف استخدام صوت مدربي",
    setOf: "المجموعة {set} من {sets}",
    reps: {
      zero: "# تكرار",
      one: "تكرار واحد",
      two: "تكراران",
      few: "# تكرارات",
      many: "# تكرارًا",
      other: "# تكرار",
    },
    lighter: "(أخف)",
    load: "{load} كغ",
    changed:
      "غيّر مدربك هذا التمرين، لذلك توقفت الجلسة. المجموعات المسجلة محفوظة. يُرجى تجهيز الجلسة مرة أخرى لتتبع الخطة الحالية.",
    prepareAgain: "التجهيز مرة أخرى",
    startSession: "بدء الجلسة",
    noMatch: "هذه الجلسة لم تعد تطابق تمرينك.",
    ended: "انتهت هذه الجلسة الصوتية. يمكنك المتابعة في سجل التمرين.",
    replies: "ردود الجلسة",
    done: "تم",
    tooHeavy: "ثقيل جدًا",
    tooEasy: "سهل جدًا",
    skip: "تخطٍّ",
    repeat: "إعادة",
    resume: "متابعة",
    pause: "إيقاف مؤقت",
    repsDone: "التكرارات المنجزة",
    logReps: "تسجيل التكرارات",
    painNote: "ضُغط زر الألم أثناء الجلسة الصوتية",
    pain: "ألم — توقف الآن",
    endEarly: "إنهاء الجلسة دون إكمالها",
    finished: "انتهى التمرين وحُفظ.",
    waiting: "اكتملت الجلسة. سيُنهى تمرينك بعد مزامنة سجلات المجموعات.",
    complete: "اكتملت الجلسة.",
    tryAgain: "المحاولة مرة أخرى",
    needAttention: {
      zero: "لا توجد سجلات مجموعات تحتاج إلى انتباه.",
      one: "سجل مجموعة واحد يحتاج إلى انتباه في سجل التمرين.",
      two: "سجلا مجموعتين يحتاجان إلى انتباه في سجل التمرين.",
      few: "# سجلات مجموعات تحتاج إلى انتباه في سجل التمرين.",
      many: "# سجلًا للمجموعات يحتاج إلى انتباه في سجل التمرين.",
      other: "# سجل مجموعات يحتاج إلى انتباه في سجل التمرين.",
    },
    spokenReplies: "الردود الصوتية",
    spokenHelp:
      "يمكنك قول «تم» أو عدد التكرارات أو «ثقيل جدًا» أو «توقف» أو «ألم». أثناء حديث صوت مدربك لا تُسمع الردود، فيُرجى استخدام الأزرار. الأزرار تعمل دائمًا.",
    listenDevice: "الاستماع على هذا الجهاز",
    theService: "خدمة الكلام",
    theProvider: "المزوّد",
    sendClips:
      "إرسال مقاطع قصيرة من ردودي إلى {provider} لتفريغها نصيًا. لا يحتفظ هذا التطبيق بالمقاطع؛ ",
    zeroRetention: "ويُطلب من المزوّد عدم الاحتفاظ بها أيضًا.",
    ownTerms: "ويتعامل معها {provider} وفق شروط الاحتفاظ بالبيانات الخاصة به.",
    listenService: "الاستماع عبر خدمة الكلام",
    noSpeech: "الردود الصوتية غير متاحة على هذا الجهاز. يُرجى استخدام الأزرار.",
    listeningDevice: "جارٍ الاستماع على هذا الجهاز.",
    listeningService: "جارٍ الاستماع عبر خدمة الكلام.",
    heard: "سُمع: {text}.",
    stopListening: "إيقاف الاستماع",
    withdraw: "سحب إذن التفريغ النصي",
    status_ready: "جاهز للبدء.",
    status_warmup: "الإحماء.",
    status_setup: "{name}: الاستعداد.",
    status_set: "{name}، المجموعة {set} من {sets}: {reps}.",
    status_setLoad: "{name}، المجموعة {set} من {sets}: {reps} بوزن {load}.",
    status_rest: {
      zero: "راحة: انتهى الوقت.",
      one: "راحة: بقيت ثانية واحدة.",
      two: "راحة: بقيت ثانيتان.",
      few: "راحة: بقيت # ثوانٍ.",
      many: "راحة: بقيت # ثانية.",
      other: "راحة: بقيت # ثانية.",
    },
    status_cooldown: "التهدئة.",
    status_finished: "اكتملت الجلسة.",
    status_paused: "متوقف مؤقتًا.",
    status_pain: "توقفت الجلسة وأُبلغ مدربك.",
    status_member: "انتهت الجلسة.",
    status_review: "توقفت الجلسة لمراجعة مدربك.",
  },
);
