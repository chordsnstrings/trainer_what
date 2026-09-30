import { defineMessages } from "../core";

/** Joining a coach, invitations, terms acceptance and switching coach. */
export default defineMessages(
  {
    joinTitle: "Join {name}",
    joinYourCoach: "Join your coach",
    yourCoach: "your coach",
    joinIntro:
      "Create your account to start coaching with {coach}. You choose your plan in the app after joining.",
    newNote:
      "Use an email address you can open: it signs you in and receives your coaching updates.",
    alreadyCoaching: "Already coaching with {coach}?",
    signIn: "Sign in",
    newHere: "I’m new here",
    newHereNote: "Create a new account",
    haveAccount: "I already have an account",
    haveAccountNote: "Use the password you have",
    haveAccountQuestion: "Do you already have an account?",
    emailInUse:
      "An account already uses this email address. Choose “I already have an account” and enter its password.",
    wrongPassword: "That password does not match the account for this email address.",
    legalPending:
      "Joining opens once the platform publishes its approved terms. Please try again later.",
    notTaking: "This coach is not taking new members online right now.",
    blockedClosed: "Joining opens once the platform publishes its terms.",
    blockedTick: "Tick the box above to accept the terms.",
    checkingTerms: "Getting the joining terms ready…",
    joining: "Joining…",
    existingNote:
      "No new account is created, and any other coaches you have stay as they are.",
    yourName: "Your name",
    emailAddress: "Email address",
    createPassword: "Create a password",
    password: "Password",
    atLeast12: "At least 12 characters.",
    mfaJoin:
      "Your account uses an authenticator app. Enter its current 6-digit code to finish joining.",
    authenticatorCode: "Authenticator code",
    joinAction: "Join",
    // Invitations
    invalidInvite:
      "This invitation link is not valid. Ask your coach to send a new invitation.",
    signInToCoaching: "Sign in to your coaching",
    cannotOpen: "This invitation can’t be opened",
    yourInvitation: "Your invitation",
    checking: "Checking your invitation…",
    usedTitle: "This invitation was already used",
    expiredTitle: "This invitation has expired",
    newerTitle: "There is a newer invitation",
    cancelledTitle: "This invitation was cancelled",
    usedText:
      "This invitation to {name} has already been used. If it was you, sign in to continue.",
    expiredText: "This invitation to {name} has expired. Ask {name} to send a new one.",
    newerText: "{name} sent you a newer invitation. Use the link in the most recent email.",
    cancelledText: "{name} cancelled this invitation. Ask {name} if you still want to join.",
    introMember:
      "{name} invited you to coaching. The invitation is for {email} and works until {date}.",
    introTeam:
      "{name} invited you to join their team. The invitation is for {email} and works until {date}.",
    unsyncedReturn: {
      one: "# workout or meal entry has not synced. It stays on this device and will sync when you return to your current coach. Continue anyway?",
      other:
        "# workout or meal entries have not synced. They stay on this device and will sync when you return to your current coach. Continue anyway?",
    },
    alreadyBelong: "You already belong to {name}",
    alreadyBelongText:
      "Open your app to continue. If you have more than one coach, switch to {name} from “Switch coach” in the app.",
    openApp: "Open my app",
    signedInAs:
      "You’re signed in as <b>{name}</b> <email>({email})</email>. Join with this account. Your other coaches stay available and you can switch between them at any time.",
    wrongAccount:
      "You’re signed in as {current}, but this invitation is for {invited}. Sign out, then open this link again with the invited account, or ask {name} to invite {current}.",
    teamPassword:
      "Team invitations are accepted with your password. Sign out, then open this link again.",
    signOutContinue: "Sign out and continue",
    inviteNewNote: "Create your account with the email address the invitation was sent to.",
    // Terms
    termsOfService: "terms of service",
    privacyPolicy: "privacy policy",
    aiDisclosure: "digital coaching disclosure",
    and: " and ",
    listComma: ", ",
    accept: "I accept the {links}.",
    pendingOne:
      "The platform’s {names} is not published yet, so you are not asked to accept it.",
    pendingMany:
      "The platform’s {names} are not published yet, so you are not asked to accept them.",
    closedNote: "Joining opens once the platform publishes its approved terms.",
    closedUntil: " Your invitation stays valid until {date}.",
    closedLater: " Please try again later.",
    // Switching coach
    coach: "Coach",
    switchCoach: "Switch coach",
    team: " (team)",
    unsyncedSwitch: {
      one: "# workout or meal entry has not synced. It stays on this device and will sync when you return to this coach. Switch anyway?",
      other:
        "# workout or meal entries have not synced. They stay on this device and will sync when you return to this coach. Switch anyway?",
    },
    yourCoaches: "Your coaches",
    joinedCoach: "You joined {name}.",
    yourNewCoach: "your new coach",
    othersStillHere: "Your other coaches are still here; switch between them below.",
    eachCoach:
      "Each coach has their own program, messages and membership. Switch at any time; nothing is shared between coaches.",
    current: "Current",
    switchTo: "Switch to {name}",
  },
  {
    joinTitle: "الانضمام إلى {name}",
    joinYourCoach: "الانضمام إلى مدربك",
    yourCoach: "مدربك",
    joinIntro:
      "يمكنك إنشاء حسابك لبدء التدريب مع {coach}، ثم اختيار باقتك داخل التطبيق بعد الانضمام.",
    newNote:
      "يُرجى استخدام بريد إلكتروني يمكنك فتحه: به تسجّل الدخول وتصلك تحديثات تدريبك.",
    alreadyCoaching: "تتدرب بالفعل مع {coach}؟",
    signIn: "تسجيل الدخول",
    newHere: "أنضم لأول مرة",
    newHereNote: "إنشاء حساب جديد",
    haveAccount: "لدي حساب بالفعل",
    haveAccountNote: "استخدام كلمة المرور الحالية",
    haveAccountQuestion: "هل لديك حساب بالفعل؟",
    emailInUse:
      "يوجد حساب يستخدم هذا البريد الإلكتروني. يُرجى اختيار «لدي حساب بالفعل» وإدخال كلمة المرور الخاصة به.",
    wrongPassword: "كلمة المرور هذه لا تطابق الحساب المرتبط بهذا البريد الإلكتروني.",
    legalPending:
      "يُفتح الانضمام بعد أن تنشر المنصة شروطها المعتمدة. يُرجى المحاولة لاحقًا.",
    notTaking: "لا يستقبل هذا المدرب مشتركين جددًا عبر الإنترنت حاليًا.",
    blockedClosed: "يُفتح الانضمام بعد أن تنشر المنصة شروطها.",
    blockedTick: "يُرجى تحديد المربع أعلاه للموافقة على الشروط.",
    checkingTerms: "جارٍ تجهيز شروط الانضمام…",
    joining: "جارٍ الانضمام…",
    existingNote: "لن يُنشأ حساب جديد، ويبقى أي مدربين آخرين لديك كما هم.",
    yourName: "اسمك",
    emailAddress: "البريد الإلكتروني",
    createPassword: "إنشاء كلمة مرور",
    password: "كلمة المرور",
    atLeast12: "12 حرفًا على الأقل.",
    mfaJoin:
      "يستخدم حسابك تطبيق مصادقة. يُرجى إدخال الرمز الحالي المكوّن من 6 أرقام لإكمال الانضمام.",
    authenticatorCode: "رمز المصادقة",
    joinAction: "الانضمام",
    invalidInvite: "رابط الدعوة هذا غير صالح. يُرجى طلب دعوة جديدة من مدربك.",
    signInToCoaching: "تسجيل الدخول إلى تدريبك",
    cannotOpen: "تعذّر فتح هذه الدعوة",
    yourInvitation: "دعوتك",
    checking: "جارٍ التحقق من دعوتك…",
    usedTitle: "سبق استخدام هذه الدعوة",
    expiredTitle: "انتهت صلاحية هذه الدعوة",
    newerTitle: "توجد دعوة أحدث",
    cancelledTitle: "أُلغيت هذه الدعوة",
    usedText:
      "سبق استخدام هذه الدعوة إلى {name}. إذا كنت أنت من استخدمها، فيُرجى تسجيل الدخول للمتابعة.",
    expiredText: "انتهت صلاحية هذه الدعوة إلى {name}. يُرجى طلب دعوة جديدة من {name}.",
    newerText: "وصلتك دعوة أحدث من {name}. يُرجى استخدام الرابط في أحدث رسالة.",
    cancelledText: "أُلغيت هذه الدعوة من قِبل {name}. يُرجى التواصل مع {name} إذا كنت ما زلت ترغب في الانضمام.",
    introMember:
      "لديك دعوة من {name} إلى التدريب. الدعوة مخصصة لـ {email} وصالحة حتى {date}.",
    introTeam:
      "لديك دعوة من {name} للانضمام إلى الفريق. الدعوة مخصصة لـ {email} وصالحة حتى {date}.",
    unsyncedReturn: {
      zero: "لا توجد إدخالات غير متزامنة. هل تريد المتابعة؟",
      one: "إدخال واحد (تمرين أو وجبة) لم تتم مزامنته. سيبقى على هذا الجهاز ويُزامَن عند عودتك إلى مدربك الحالي. هل تريد المتابعة رغم ذلك؟",
      two: "إدخالان لم تتم مزامنتهما. سيبقيان على هذا الجهاز ويُزامَنان عند عودتك إلى مدربك الحالي. هل تريد المتابعة رغم ذلك؟",
      few: "# إدخالات لم تتم مزامنتها. ستبقى على هذا الجهاز وتُزامَن عند عودتك إلى مدربك الحالي. هل تريد المتابعة رغم ذلك؟",
      many: "# إدخالًا لم تتم مزامنتها. ستبقى على هذا الجهاز وتُزامَن عند عودتك إلى مدربك الحالي. هل تريد المتابعة رغم ذلك؟",
      other:
        "# إدخال لم تتم مزامنتها. ستبقى على هذا الجهاز وتُزامَن عند عودتك إلى مدربك الحالي. هل تريد المتابعة رغم ذلك؟",
    },
    alreadyBelong: "حسابك مشترك بالفعل مع {name}",
    alreadyBelongText:
      "يمكنك فتح تطبيقك للمتابعة. إذا كان لديك أكثر من مدرب، فيمكنك التبديل إلى {name} من «تبديل المدرب» في التطبيق.",
    openApp: "فتح تطبيقي",
    signedInAs:
      "تم تسجيل دخولك باسم <b>{name}</b> <email>({email})</email>. يمكنك الانضمام بهذا الحساب، ويبقى مدربوك الآخرون متاحين مع إمكانية التبديل بينهم في أي وقت.",
    wrongAccount:
      "تم تسجيل دخولك باسم {current}، لكن هذه الدعوة مخصصة لـ {invited}. يُرجى تسجيل الخروج ثم فتح هذا الرابط مجددًا بالحساب المدعو، أو طلب دعوة لـ {current} من {name}.",
    teamPassword:
      "تُقبل دعوات الفريق بكلمة المرور. يُرجى تسجيل الخروج ثم فتح هذا الرابط مجددًا.",
    signOutContinue: "تسجيل الخروج والمتابعة",
    inviteNewNote: "يُرجى إنشاء حسابك بالبريد الإلكتروني الذي أُرسلت إليه الدعوة.",
    termsOfService: "شروط الخدمة",
    privacyPolicy: "سياسة الخصوصية",
    aiDisclosure: "إفصاح التدريب الرقمي",
    and: " و",
    listComma: "، ",
    accept: "أوافق على {links}.",
    pendingOne: "لم تُنشر بعد {names} الخاصة بالمنصة، لذلك لا يُطلب منك الموافقة عليها.",
    pendingMany: "لم تُنشر بعد {names} الخاصة بالمنصة، لذلك لا يُطلب منك الموافقة عليها.",
    closedNote: "يُفتح الانضمام بعد أن تنشر المنصة شروطها المعتمدة.",
    closedUntil: " تبقى دعوتك صالحة حتى {date}.",
    closedLater: " يُرجى المحاولة لاحقًا.",
    coach: "المدرب",
    switchCoach: "تبديل المدرب",
    team: " (الفريق)",
    unsyncedSwitch: {
      zero: "لا توجد إدخالات غير متزامنة. هل تريد التبديل؟",
      one: "إدخال واحد (تمرين أو وجبة) لم تتم مزامنته. سيبقى على هذا الجهاز ويُزامَن عند عودتك إلى هذا المدرب. هل تريد التبديل رغم ذلك؟",
      two: "إدخالان لم تتم مزامنتهما. سيبقيان على هذا الجهاز ويُزامَنان عند عودتك إلى هذا المدرب. هل تريد التبديل رغم ذلك؟",
      few: "# إدخالات لم تتم مزامنتها. ستبقى على هذا الجهاز وتُزامَن عند عودتك إلى هذا المدرب. هل تريد التبديل رغم ذلك؟",
      many: "# إدخالًا لم تتم مزامنتها. ستبقى على هذا الجهاز وتُزامَن عند عودتك إلى هذا المدرب. هل تريد التبديل رغم ذلك؟",
      other:
        "# إدخال لم تتم مزامنتها. ستبقى على هذا الجهاز وتُزامَن عند عودتك إلى هذا المدرب. هل تريد التبديل رغم ذلك؟",
    },
    yourCoaches: "مدربوك",
    joinedCoach: "انضممت إلى {name}.",
    yourNewCoach: "مدربك الجديد",
    othersStillHere: "مدربوك الآخرون ما زالوا هنا، ويمكنك التبديل بينهم أدناه.",
    eachCoach:
      "لكل مدرب برنامجه ورسائله واشتراكه. يمكنك التبديل في أي وقت، ولا يُشارك أي شيء بين المدربين.",
    current: "الحالي",
    switchTo: "التبديل إلى {name}",
  },
);
