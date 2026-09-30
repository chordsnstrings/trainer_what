import { defineMessages } from "../core";

/**
 * Sign-in, recovery and email-link pages, the coach's public header and
 * the subscriber footer.
 */
export default defineMessages(
  {
    // Header and footer
    coachingWebsite: "Coaching website",
    account: "Account",
    signIn: "Sign in",
    joinCoaching: "Join coaching",
    coachLinks: "{name} links",
    helpAndLegal: "Help and legal",
    findCoach: "Find a coach",
    memberSignIn: "Member sign in",
    terms: "Terms",
    privacy: "Privacy",
    digitalCoaching: "Digital coaching",
    analyticsPreferences: "Analytics preferences",
    notMedicalAdvice: ". Coaching is not medical advice.",
    returnToSignIn: "Return to sign in",
    // Sign in
    signInTitle: "Sign in",
    signInAgainAnyTime: "Sign in any time with the same email address.",
    welcomeBackCoach: "Welcome back. Sign in to your coaching with {coach}.",
    welcomeBack: "Welcome back. Sign in with the email address you use for coaching.",
    emailAddress: "Email address",
    password: "Password",
    forgotPassword: "Forgot your password?",
    mfaNeeded:
      "Your account uses an authenticator app. Enter its current 6-digit code to finish signing in.",
    authenticatorCode: "Authenticator code",
    signingIn: "Signing in…",
    otherWays: "Other ways to sign in",
    emailLink: "Email me a sign-in link",
    lostAuthenticator: "Lost your authenticator app? Use a recovery code",
    newHere: "New here?",
    joinName: "Join {name}",
    joinCoachingLink: "Join coaching",
    lookingForCoach: "Looking for a coach?",
    areYouCoach: "Are you a coach?",
    createCoachingSpace: "Create your coaching space",
    // Ended membership and leaving
    endedTitle: "Your coaching membership has ended",
    noMembershipTitle: "You have no active coaching membership",
    endedText:
      "Your membership has ended, so there is no coaching to open. Your account stays open.",
    noMembershipText:
      "Your account is open, but it is not linked to a coach right now.",
    whatNext: "What you can do next:",
    rejoin: "Rejoin {name}",
    thisCoach: "this coach",
    invitationHint:
      "Have an invitation from a coach? Open the link in their email to join with this account.",
    youLeft: "You left {name}",
    yourCoach: "your coach",
    renewalCancelled:
      "Your membership renewal is cancelled, so no further payments are taken. ",
    accountStillOpen:
      "Your account is still open: you can join another coach with the same email address at any time.",
    backToWebsite: "Back to the website",
    // Email link and authenticator recovery
    recoverTitle: "Recover your authenticator",
    confirmSignInTitle: "Confirm your sign-in",
    emailLinkTitle: "Email me a sign-in link",
    recoverIntro:
      "Use a saved recovery code and your password. You will be signed out on your other devices and your old recovery codes stop working.",
    confirmIntro:
      "Confirm below to use this link. If you use an authenticator app, enter its current code.",
    emailLinkIntro:
      "We’ll email you a link that signs you in once. It works for 15 minutes. If you use an authenticator app, you’ll still need its code.",
    emailLinkSent:
      "If this email address has an account, a sign-in link is on its way. It works once, for 15 minutes.",
    codeIfUsed: "Authenticator code (only if you use one)",
    currentPassword: "Current password",
    recoveryCode: "Saved recovery code",
    recoverButton: "Recover authenticator",
    confirmButton: "Confirm sign-in",
    sendLink: "Send sign-in link",
    // Password recovery and email verification
    verifyTitle: "Verify your email",
    newPasswordTitle: "Choose a new password",
    resetTitle: "Reset your password",
    verifyIntro: "Confirm that this email address is yours.",
    newPasswordIntro: "Use at least 12 characters. You will sign in with it next time.",
    resetIntro:
      "Enter the email address you sign in with. If it has an account, we’ll email you a link to choose a new password.",
    verified: "Email verified. You can return to your workspace.",
    passwordChanged: "Password changed. Sign in with your new password.",
    resetSent:
      "If this email address has an account, a link to choose a new password is on its way.",
    newPassword: "New password",
    verifyButton: "Verify email",
    savePassword: "Save password",
    sendResetLink: "Send reset link",
    // Apple and Google
    or: "or",
    acceptPublished:
      "I accept the published terms and understand the digital coaching disclosure.",
    opening: "Opening {provider}…",
    continueWith: "Continue with {provider}",
    yourAccount: "YOUR ACCOUNT",
    oneMoreStep: "One more step.",
    signInExpired: "This sign-in expired. Start again from the sign-in page.",
    providerConfirmed:
      "{provider} confirmed your identity. Enter the six-digit code from your authenticator app to finish signing in.",
    checkingSignIn: "Checking your sign-in…",
    finishSignIn: "Finish signing in",
    OIDC_CANCELLED: "Sign-in was cancelled.",
    OIDC_EXPIRED: "That sign-in expired or was already used. Start again.",
    OIDC_BROWSER_MISMATCH: "Finish signing in in the same browser where you started.",
    OIDC_EMAIL_UNVERIFIED:
      "Your Apple or Google account did not confirm a verified email address.",
    OIDC_LINK_REQUIRED:
      "An account already uses this email. Sign in with your password, then link Apple or Google in Account settings.",
    OIDC_NO_ACCOUNT:
      "No account uses this Apple or Google account yet. Join a coach or open your invitation to create one.",
    OIDC_PLATFORM_ONLY:
      "Apple and Google sign-in are available on the main platform address.",
    OIDC_LINK_EXPIRED:
      "Your session ended before linking finished. Sign in and try again.",
    NO_MEMBERSHIP:
      "Your account has no active coaching workspace. Join a coach to continue.",
    MEMBERSHIP_ENDED:
      "Your coaching membership has ended, so there is no workspace to open. Your account remains; join a coach to continue. Signing in with your password or a passkey shows your coach's message.",
    REMOVED_BY_TRAINER:
      "This coach ended your membership, so you can rejoin only through a new invitation from them.",
    LEGAL_PENDING: "New accounts are paused until the published terms are approved.",
    TRAINER_UNAVAILABLE: "This coach is not accepting new members right now.",
    INVALID_INVITE: "This invitation is invalid or expired.",
    INVITE_EMAIL_MISMATCH:
      "Use the Apple or Google account for the invited email address.",
    IDENTITY_IN_USE:
      "That Apple or Google account is already linked to another account.",
    PROVIDER_ALREADY_LINKED: "Remove the currently linked account first.",
    signInFailed: "Sign-in could not be completed. Try again or use your password.",
    // Passkeys
    passkeySignIn: "Sign in with a passkey",
    passkeyCancelled: "Passkey selection was canceled or timed out.",
  },
  {
    coachingWebsite: "موقع التدريب",
    account: "الحساب",
    signIn: "تسجيل الدخول",
    joinCoaching: "الانضمام إلى التدريب",
    coachLinks: "روابط {name}",
    helpAndLegal: "المساعدة والشروط",
    findCoach: "البحث عن مدرب",
    memberSignIn: "دخول المشتركين",
    terms: "الشروط",
    privacy: "الخصوصية",
    digitalCoaching: "التدريب الرقمي",
    analyticsPreferences: "تفضيلات التحليلات",
    notMedicalAdvice: ". التدريب ليس نصيحة طبية.",
    returnToSignIn: "العودة إلى تسجيل الدخول",
    signInTitle: "تسجيل الدخول",
    signInAgainAnyTime: "يمكنك تسجيل الدخول في أي وقت بالبريد الإلكتروني نفسه.",
    welcomeBackCoach: "مرحبًا بعودتك إلى تدريبك مع {coach}.",
    welcomeBack: "مرحبًا بعودتك. يمكنك تسجيل الدخول بالبريد الإلكتروني الذي تستخدمه للتدريب.",
    emailAddress: "البريد الإلكتروني",
    password: "كلمة المرور",
    forgotPassword: "نسيت كلمة المرور؟",
    mfaNeeded:
      "يستخدم حسابك تطبيق مصادقة. يُرجى إدخال الرمز الحالي المكوّن من 6 أرقام لإكمال تسجيل الدخول.",
    authenticatorCode: "رمز المصادقة",
    signingIn: "جارٍ تسجيل الدخول…",
    otherWays: "طرق أخرى لتسجيل الدخول",
    emailLink: "إرسال رابط تسجيل الدخول إلى بريدي",
    lostAuthenticator: "هل فقدت تطبيق المصادقة؟ يمكنك استخدام رمز استرداد",
    newHere: "أول مرة هنا؟",
    joinName: "الانضمام إلى {name}",
    joinCoachingLink: "الانضمام إلى التدريب",
    lookingForCoach: "تبحث عن مدرب؟",
    areYouCoach: "هل تقدّم التدريب؟",
    createCoachingSpace: "إنشاء مساحة التدريب الخاصة بك",
    endedTitle: "انتهى اشتراكك في التدريب",
    noMembershipTitle: "لا يوجد لديك اشتراك تدريب فعّال",
    endedText: "انتهى اشتراكك، لذلك لا يوجد تدريب لفتحه. يبقى حسابك مفتوحًا.",
    noMembershipText: "حسابك مفتوح، لكنه غير مرتبط بمدرب حاليًا.",
    whatNext: "ما يمكنك فعله الآن:",
    rejoin: "الانضمام مجددًا إلى {name}",
    thisCoach: "هذا المدرب",
    invitationHint:
      "لديك دعوة من مدرب؟ يمكنك فتح الرابط في رسالته للانضمام بهذا الحساب.",
    youLeft: "غادرت {name}",
    yourCoach: "مدربك",
    renewalCancelled: "أُلغي تجديد اشتراكك، لذلك لن تُخصم أي مدفوعات أخرى. ",
    accountStillOpen:
      "حسابك ما زال مفتوحًا: يمكنك الانضمام إلى مدرب آخر بالبريد الإلكتروني نفسه في أي وقت.",
    backToWebsite: "العودة إلى الموقع",
    recoverTitle: "استرداد تطبيق المصادقة",
    confirmSignInTitle: "تأكيد تسجيل الدخول",
    emailLinkTitle: "إرسال رابط تسجيل الدخول إلى بريدي",
    recoverIntro:
      "يلزم رمز استرداد محفوظ وكلمة المرور. سيتم تسجيل خروجك من أجهزتك الأخرى، وتتوقف رموز الاسترداد القديمة عن العمل.",
    confirmIntro:
      "يُرجى التأكيد أدناه لاستخدام هذا الرابط. إذا كنت تستخدم تطبيق مصادقة، فيُرجى إدخال رمزه الحالي.",
    emailLinkIntro:
      "سنرسل إلى بريدك رابطًا يسجّل دخولك مرة واحدة، ويعمل لمدة 15 دقيقة. إذا كنت تستخدم تطبيق مصادقة، فستحتاج إلى رمزه أيضًا.",
    emailLinkSent:
      "إذا كان لهذا البريد الإلكتروني حساب، فرابط تسجيل الدخول في طريقه إليك. يعمل مرة واحدة ولمدة 15 دقيقة.",
    codeIfUsed: "رمز المصادقة (فقط إذا كنت تستخدمه)",
    currentPassword: "كلمة المرور الحالية",
    recoveryCode: "رمز الاسترداد المحفوظ",
    recoverButton: "استرداد تطبيق المصادقة",
    confirmButton: "تأكيد تسجيل الدخول",
    sendLink: "إرسال رابط تسجيل الدخول",
    verifyTitle: "تأكيد بريدك الإلكتروني",
    newPasswordTitle: "اختيار كلمة مرور جديدة",
    resetTitle: "إعادة تعيين كلمة المرور",
    verifyIntro: "يُرجى تأكيد أن هذا البريد الإلكتروني يخصك.",
    newPasswordIntro: "12 حرفًا على الأقل. ستسجّل الدخول بها في المرة القادمة.",
    resetIntro:
      "يُرجى إدخال البريد الإلكتروني الذي تسجّل الدخول به. إذا كان له حساب، فسنرسل إليك رابطًا لاختيار كلمة مرور جديدة.",
    verified: "تم تأكيد البريد الإلكتروني. يمكنك العودة إلى مساحتك.",
    passwordChanged: "تم تغيير كلمة المرور. يمكنك الآن تسجيل الدخول بكلمة المرور الجديدة.",
    resetSent:
      "إذا كان لهذا البريد الإلكتروني حساب، فرابط اختيار كلمة مرور جديدة في طريقه إليك.",
    newPassword: "كلمة المرور الجديدة",
    verifyButton: "تأكيد البريد الإلكتروني",
    savePassword: "حفظ كلمة المرور",
    sendResetLink: "إرسال رابط إعادة التعيين",
    or: "أو",
    acceptPublished: "أوافق على الشروط المنشورة وأفهم إفصاح التدريب الرقمي.",
    opening: "جارٍ فتح {provider}…",
    continueWith: "المتابعة باستخدام {provider}",
    yourAccount: "حسابك",
    oneMoreStep: "خطوة أخيرة.",
    signInExpired: "انتهت مهلة تسجيل الدخول هذا. يُرجى البدء من جديد من صفحة تسجيل الدخول.",
    providerConfirmed:
      "أكّد {provider} هويتك. يُرجى إدخال الرمز المكوّن من ستة أرقام من تطبيق المصادقة لإكمال تسجيل الدخول.",
    checkingSignIn: "جارٍ التحقق من تسجيل الدخول…",
    finishSignIn: "إكمال تسجيل الدخول",
    OIDC_CANCELLED: "أُلغي تسجيل الدخول.",
    OIDC_EXPIRED: "انتهت مهلة تسجيل الدخول أو سبق استخدامه. يُرجى البدء من جديد.",
    OIDC_BROWSER_MISMATCH: "يُرجى إكمال تسجيل الدخول في المتصفح نفسه الذي بدأت فيه.",
    OIDC_EMAIL_UNVERIFIED: "لم يؤكد حساب Apple أو Google بريدًا إلكترونيًا موثّقًا.",
    OIDC_LINK_REQUIRED:
      "يوجد حساب يستخدم هذا البريد الإلكتروني. يُرجى تسجيل الدخول بكلمة المرور، ثم ربط Apple أو Google من إعدادات الحساب.",
    OIDC_NO_ACCOUNT:
      "لا يوجد حساب يستخدم حساب Apple أو Google هذا بعد. يمكنك الانضمام إلى مدرب أو فتح دعوتك لإنشاء حساب.",
    OIDC_PLATFORM_ONLY: "تسجيل الدخول عبر Apple وGoogle متاح على العنوان الرئيسي للمنصة.",
    OIDC_LINK_EXPIRED: "انتهت جلستك قبل اكتمال الربط. يُرجى تسجيل الدخول والمحاولة مرة أخرى.",
    NO_MEMBERSHIP: "لا توجد لحسابك مساحة تدريب فعّالة. يمكنك الانضمام إلى مدرب للمتابعة.",
    MEMBERSHIP_ENDED:
      "انتهى اشتراكك في التدريب، لذلك لا توجد مساحة لفتحها. يبقى حسابك موجودًا، ويمكنك الانضمام إلى مدرب للمتابعة. يعرض تسجيل الدخول بكلمة المرور أو مفتاح المرور رسالة مدربك.",
    REMOVED_BY_TRAINER:
      "أنهى هذا المدرب اشتراكك، لذلك لا يمكنك الانضمام مجددًا إلا بدعوة جديدة منه.",
    LEGAL_PENDING: "الحسابات الجديدة متوقفة حتى تتم الموافقة على الشروط المنشورة.",
    TRAINER_UNAVAILABLE: "لا يستقبل هذا المدرب مشتركين جددًا حاليًا.",
    INVALID_INVITE: "هذه الدعوة غير صالحة أو انتهت صلاحيتها.",
    INVITE_EMAIL_MISMATCH: "يُرجى استخدام حساب Apple أو Google الخاص بالبريد الإلكتروني المدعو.",
    IDENTITY_IN_USE: "حساب Apple أو Google هذا مرتبط بحساب آخر.",
    PROVIDER_ALREADY_LINKED: "يُرجى إزالة الحساب المرتبط حاليًا أولًا.",
    signInFailed: "تعذّر إكمال تسجيل الدخول. يُرجى المحاولة مرة أخرى أو استخدام كلمة المرور.",
    passkeySignIn: "تسجيل الدخول بمفتاح مرور",
    passkeyCancelled: "أُلغي اختيار مفتاح المرور أو انتهت مهلته.",
  },
);
