import { defineMessages } from "../core";

/** Push notification permission texts and the settings card. */
export default defineMessages(
  {
    errSignIn: "Your sign-in needs refreshing. Sign in again, then retry.",
    errLimit:
      "Push setup changed or the device limit was reached. Refresh, remove an unused device if needed, then retry.",
    errUnavailable: "Push notifications are temporarily unavailable. Try again later.",
    errFailed: "The push settings request failed. Refresh and try again.",
    errPreparing:
      "The app is still preparing notifications. Check your connection and try again.",
    errPrepare: "The app could not prepare notifications. Refresh and retry.",
    errNotAllowed:
      "Notifications were not allowed. Check this site's notification permission in your browser settings, then retry.",
    blockedApp:
      "Notifications are blocked for this app. You can allow them later in your phone's settings.",
    stillOff:
      "Notifications are still off. You can turn them on any time in Profile and settings.",
    installedApp: "Installed app",
    thisBrowser: "This browser",
    onForPhone: "Notifications are on for this phone.",
    couldNotTurnOn:
      "Notifications could not be turned on. Try again from Profile and settings.",
    couldNotLoad: "Could not load push settings. Check your connection and retry.",
    expired:
      "Your browser's push connection expired. Reconnect to receive updates again.",
    blockedSite:
      "Notifications are blocked. Allow them in this site's browser settings, then return and refresh.",
    notEnabled:
      "Notifications were not enabled. You can try again when you are ready.",
    oldNotCleared:
      "The old push connection could not be cleared. Retry or remove this site's notification permission in your browser settings.",
    enabledBrowser: "Push notifications are enabled for this browser.",
    couldNotConfirm:
      "Could not confirm this browser's push connection. Check your connection, then retry enabling it.",
    couldNotRemove:
      "Could not remove the saved device. Check your connection, then retry its Remove button.",
    subscriptionCleared:
      "This browser's push subscription is cleared. Its saved device still needs to be removed.",
    partlyDisconnected:
      "Push is disconnected from your account, but the browser subscription could not be cleared. Retry clearing it or use this site's notification settings.",
    deviceRemoved: "Device removed. It will no longer receive updates.",
    disabledBrowser: "Push notifications are disabled for this browser.",
    title: "Browser push notifications",
    intro:
      "Get a generic update alert while the app is closed. Open your inbox to see the details.",
    checking: "Checking push notifications…",
    notConfigured:
      "Push notifications have not been configured for this app. You can still remove saved devices below.",
    insecure: "Open this app over HTTPS to enable browser push notifications.",
    iosInstall:
      "On iPhone or iPad, open the Share menu and choose Add to Home Screen. Open the installed app, sign in, then enable notifications here.",
    unsupported:
      "This browser does not support push notifications. Your in-app inbox remains available.",
    deniedBrowser:
      "Notifications are blocked in your browser. Allow this site in your browser's notification settings, then refresh below.",
    readFailed:
      "The browser connection could not be checked. Refresh to retry; saved devices can still be removed.",
    enabledSession: "Enabled for this browser and sign-in session.",
    reconnectHint:
      "Reconnect this browser after a session, browser subscription, or push configuration change.",
    deviceLabel: "Device label",
    deviceLabelExample: "For example, Personal phone",
    updating: "Updating…",
    reconnect: "Reconnect this browser",
    enable: "Enable push on this browser",
    clearSubscription: "Clear this browser subscription",
    savedDevices: "Saved devices ({count}/{max})",
    noDevices: "No devices are connected to your account.",
    thisSession: " · This sign-in session",
    connectionEnds: "Connection ends {date}",
    removeDevice: "Remove {name}",
    removeDeviceHere: "Remove {name} from this browser",
    stopsWhen:
      "Push stops when you sign out, revoke this session, or the session expires. Enable it again after signing in. Removing another device disconnects it from this account.",
    refresh: "Refresh push status",
  },
  {
    errSignIn: "يجب تحديث تسجيل دخولك. يُرجى تسجيل الدخول مرة أخرى ثم إعادة المحاولة.",
    errLimit:
      "تغيّر إعداد الإشعارات أو وصلت إلى الحد الأقصى للأجهزة. يُرجى التحديث، وإزالة جهاز غير مستخدم عند الحاجة، ثم إعادة المحاولة.",
    errUnavailable: "إشعارات الدفع غير متاحة مؤقتًا. يُرجى المحاولة لاحقًا.",
    errFailed: "تعذّر طلب إعدادات الإشعارات. يُرجى التحديث والمحاولة مرة أخرى.",
    errPreparing:
      "ما زال التطبيق يجهّز الإشعارات. يُرجى التحقق من الاتصال والمحاولة مرة أخرى.",
    errPrepare: "تعذّر على التطبيق تجهيز الإشعارات. يُرجى التحديث وإعادة المحاولة.",
    errNotAllowed:
      "لم يُسمح بالإشعارات. يُرجى التحقق من إذن الإشعارات لهذا الموقع في إعدادات المتصفح ثم إعادة المحاولة.",
    blockedApp:
      "الإشعارات محظورة لهذا التطبيق. يمكنك السماح بها لاحقًا من إعدادات هاتفك.",
    stillOff:
      "ما زالت الإشعارات متوقفة. يمكنك تفعيلها في أي وقت من «الملف الشخصي والإعدادات».",
    installedApp: "التطبيق المثبّت",
    thisBrowser: "هذا المتصفح",
    onForPhone: "الإشعارات مفعّلة على هذا الهاتف.",
    couldNotTurnOn:
      "تعذّر تفعيل الإشعارات. يُرجى المحاولة مرة أخرى من «الملف الشخصي والإعدادات».",
    couldNotLoad: "تعذّر تحميل إعدادات الإشعارات. يُرجى التحقق من الاتصال وإعادة المحاولة.",
    expired:
      "انتهى اتصال الإشعارات في متصفحك. يُرجى إعادة الربط لتلقي التحديثات مجددًا.",
    blockedSite:
      "الإشعارات محظورة. يُرجى السماح بها في إعدادات المتصفح لهذا الموقع، ثم العودة والتحديث.",
    notEnabled: "لم تُفعَّل الإشعارات. يمكنك المحاولة مرة أخرى في أي وقت.",
    oldNotCleared:
      "تعذّر مسح اتصال الإشعارات القديم. يُرجى إعادة المحاولة أو إزالة إذن الإشعارات لهذا الموقع من إعدادات المتصفح.",
    enabledBrowser: "إشعارات الدفع مفعّلة لهذا المتصفح.",
    couldNotConfirm:
      "تعذّر تأكيد اتصال الإشعارات في هذا المتصفح. يُرجى التحقق من الاتصال ثم إعادة محاولة التفعيل.",
    couldNotRemove:
      "تعذّرت إزالة الجهاز المحفوظ. يُرجى التحقق من الاتصال ثم الضغط على زر الإزالة مرة أخرى.",
    subscriptionCleared:
      "تم مسح اشتراك الإشعارات في هذا المتصفح، لكن ما زال يلزم إزالة الجهاز المحفوظ.",
    partlyDisconnected:
      "تم فصل الإشعارات عن حسابك، لكن تعذّر مسح اشتراك المتصفح. يُرجى إعادة محاولة المسح أو استخدام إعدادات الإشعارات لهذا الموقع.",
    deviceRemoved: "تمت إزالة الجهاز، ولن يتلقى التحديثات بعد الآن.",
    disabledBrowser: "إشعارات الدفع متوقفة لهذا المتصفح.",
    title: "إشعارات المتصفح",
    intro:
      "تنبيه عام بوجود تحديث حتى عندما يكون التطبيق مغلقًا. التفاصيل في صندوق الوارد.",
    checking: "جارٍ التحقق من الإشعارات…",
    notConfigured:
      "لم تُعدّ إشعارات الدفع لهذا التطبيق بعد. ما زال بإمكانك إزالة الأجهزة المحفوظة أدناه.",
    insecure: "يلزم فتح هذا التطبيق عبر HTTPS لتفعيل إشعارات المتصفح.",
    iosInstall:
      "على iPhone أو iPad: قائمة المشاركة ثم «إضافة إلى الشاشة الرئيسية». بعدها يمكنك فتح التطبيق المثبّت وتسجيل الدخول وتفعيل الإشعارات من هنا.",
    unsupported:
      "هذا المتصفح لا يدعم إشعارات الدفع. يبقى صندوق الوارد داخل التطبيق متاحًا.",
    deniedBrowser:
      "الإشعارات محظورة في متصفحك. يُرجى السماح لهذا الموقع في إعدادات الإشعارات بالمتصفح، ثم التحديث أدناه.",
    readFailed:
      "تعذّر التحقق من اتصال المتصفح. يمكنك التحديث لإعادة المحاولة، وما زال بالإمكان إزالة الأجهزة المحفوظة.",
    enabledSession: "مفعّلة لهذا المتصفح ولجلسة تسجيل الدخول هذه.",
    reconnectHint:
      "يلزم إعادة ربط هذا المتصفح بعد تغيّر الجلسة أو اشتراك المتصفح أو إعداد الإشعارات.",
    deviceLabel: "اسم الجهاز",
    deviceLabelExample: "مثلًا: هاتفي الشخصي",
    updating: "جارٍ التحديث…",
    reconnect: "إعادة ربط هذا المتصفح",
    enable: "تفعيل الإشعارات في هذا المتصفح",
    clearSubscription: "مسح اشتراك هذا المتصفح",
    savedDevices: "الأجهزة المحفوظة ({count}/{max})",
    noDevices: "لا توجد أجهزة متصلة بحسابك.",
    thisSession: " · جلسة تسجيل الدخول هذه",
    connectionEnds: "ينتهي الاتصال في {date}",
    removeDevice: "إزالة {name}",
    removeDeviceHere: "إزالة {name} من هذا المتصفح",
    stopsWhen:
      "تتوقف الإشعارات عند تسجيل الخروج أو إلغاء هذه الجلسة أو انتهائها، ويمكن تفعيلها مجددًا بعد تسجيل الدخول. إزالة جهاز آخر تفصله عن هذا الحساب.",
    refresh: "تحديث حالة الإشعارات",
  },
);
