import { defineMessages } from "../core";

/** The member app frame: top bar, tab bar, side navigation, More, footer. */
export default defineMessages(
  {
    skipToContent: "Skip to content",
    mainNavigation: "Main navigation",
    unread: {
      one: ", # unread message",
      other: ", # unread messages",
    },
    offline: "Offline",
    backOnline: "Back online",
    offlineDetail:
      ". Workouts and meals you log are saved on this phone and sync when you are back online.",
    profileSignedInAs: "Profile and settings, signed in as {name}",
    loadingWorkspace: "Opening your workspace…",
    unavailableTitle: "Your workspace is temporarily unavailable.",
    refreshFailed: "The app could not connect just now.",
    lastLoadedShown: "Your last loaded workspace is still shown.",
    devNote:
      "Development environment: payments are switched off and demo records are made up.",
    signOutUnsynced: {
      one: "# workout or meal entry has not synced. It stays on this device and will sync after you sign in here again. Sign out anyway?",
      other:
        "# workout or meal entries have not synced. They stay on this device and will sync after you sign in here again. Sign out anyway?",
    },
    offlineMember:
      "You’re offline. Workout logs are kept on this device until they can sync.",
    loadOlderSupport: "Load older support conversations",
    mealLogOnlyMembers: "Meal logging is available in a subscriber’s coaching space.",
    nfTitle: "This page does not exist",
    nfText:
      "The link may be old or mistyped. Everything in your coaching space is one tap away from Today or More.",
    nfToday: "Go to Today",
    nfMore: "See everything in More",
    unTitle: "Your workspace could not be opened",
    unText:
      "Your saved workouts and meals are safe. If this keeps happening, contact your coach or try again in a few minutes.",
    unTrying: "Trying again…",
    unTryAgain: "Try again",
    unSignOut: "Sign out",
  },
  {
    skipToContent: "الانتقال إلى المحتوى",
    mainNavigation: "التنقل الرئيسي",
    unread: {
      zero: "، لا رسائل غير مقروءة",
      one: "، رسالة واحدة غير مقروءة",
      two: "، رسالتان غير مقروءتين",
      few: "، # رسائل غير مقروءة",
      many: "، # رسالة غير مقروءة",
      other: "، # رسالة غير مقروءة",
    },
    offline: "غير متصل",
    backOnline: "عاد الاتصال",
    offlineDetail:
      ". التمارين والوجبات التي تسجلها تُحفظ على هذا الهاتف وتُزامَن عند عودة الاتصال.",
    profileSignedInAs: "الملف الشخصي والإعدادات، تم تسجيل الدخول باسم {name}",
    loadingWorkspace: "جارٍ فتح مساحتك…",
    unavailableTitle: "مساحتك غير متاحة مؤقتًا.",
    refreshFailed: "تعذّر على التطبيق الاتصال الآن.",
    lastLoadedShown: "ما زالت آخر نسخة محمّلة من مساحتك معروضة.",
    devNote: "بيئة تطوير: المدفوعات متوقفة والسجلات التجريبية غير حقيقية.",
    signOutUnsynced: {
      zero: "لا توجد إدخالات غير متزامنة. هل تريد تسجيل الخروج؟",
      one: "إدخال تمرين أو وجبة واحد لم تتم مزامنته. سيبقى على هذا الجهاز ويُزامَن بعد تسجيل الدخول هنا مرة أخرى. هل تريد تسجيل الخروج رغم ذلك؟",
      two: "إدخالان من التمارين أو الوجبات لم تتم مزامنتهما. سيبقيان على هذا الجهاز ويُزامَنان بعد تسجيل الدخول هنا مرة أخرى. هل تريد تسجيل الخروج رغم ذلك؟",
      few: "# إدخالات من التمارين أو الوجبات لم تتم مزامنتها. ستبقى على هذا الجهاز وتُزامَن بعد تسجيل الدخول هنا مرة أخرى. هل تريد تسجيل الخروج رغم ذلك؟",
      many: "# إدخالًا من التمارين أو الوجبات لم تتم مزامنتها. ستبقى على هذا الجهاز وتُزامَن بعد تسجيل الدخول هنا مرة أخرى. هل تريد تسجيل الخروج رغم ذلك؟",
      other:
        "# إدخال من التمارين أو الوجبات لم تتم مزامنتها. ستبقى على هذا الجهاز وتُزامَن بعد تسجيل الدخول هنا مرة أخرى. هل تريد تسجيل الخروج رغم ذلك؟",
    },
    offlineMember:
      "أنت غير متصل. تُحفظ سجلات التمارين على هذا الجهاز حتى تتم مزامنتها.",
    loadOlderSupport: "تحميل محادثات الدعم الأقدم",
    mealLogOnlyMembers: "تسجيل الوجبات متاح في مساحة التدريب الخاصة بالمشترك.",
    nfTitle: "هذه الصفحة غير موجودة",
    nfText:
      "قد يكون الرابط قديمًا أو مكتوبًا بشكل خاطئ. كل ما في مساحة تدريبك على بُعد نقرة من «اليوم» أو «المزيد».",
    nfToday: "الانتقال إلى «اليوم»",
    nfMore: "عرض كل شيء في «المزيد»",
    unTitle: "تعذّر فتح مساحتك",
    unText:
      "تمارينك ووجباتك المحفوظة في أمان. إذا تكرر ذلك، يُرجى التواصل مع مدربك أو المحاولة بعد بضع دقائق.",
    unTrying: "جارٍ إعادة المحاولة…",
    unTryAgain: "المحاولة مرة أخرى",
    unSignOut: "تسجيل الخروج",
  },
);
