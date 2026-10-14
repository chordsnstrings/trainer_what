-- Owner-requested commercial terms. Append a published version; keep prior acceptances.
-- Do not change legal approval, credentials, financial history, or existing prices.
DO $release$
DECLARE
 publisher uuid := 'b5d8b077-5255-4bc1-bd64-cc46a3493390';
 prior record;
 document_id uuid;
 next_version integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('document:legal:terms'));
 IF EXISTS (SELECT 1 FROM admin_operations_audit WHERE action='legal.release_published' AND subject_id='membership-2026-10-14') THEN RETURN; END IF;
 SELECT * INTO prior FROM admin_documents WHERE kind='legal' AND key='terms' AND status='published' ORDER BY version DESC LIMIT 1;
 IF prior.id IS NULL THEN RETURN; END IF;
 INSERT INTO users(id,email,name,password_hash,email_verified,platform_role)
 VALUES(publisher,'legal-release-20261007@system.invalid','Policy release automation','disabled-release-identity',false,'none') ON CONFLICT(id) DO NOTHING;
 SELECT coalesce(max(version),0)+1 INTO next_version FROM admin_documents WHERE kind='legal' AND key='terms';
 document_id := gen_random_uuid();
 INSERT INTO admin_documents(id,kind,key,version,title,content,status,effective_at,created_by,published_by,published_at)
 VALUES(document_id,'legal','terms',next_version,prior.title,prior.content || E'\n\n' || $commercial$Commercial update — 14 October 2026, for new purchases: monthly training starts at AED 199; training with nutrition at AED 299; training, nutrition and voice-guided training at AED 399. Training with voice starts at AED 299. Trainers may charge more. Nutrition is a paid feature: it requires a current paid training membership and either nutrition in the purchased plan or a current nutrition pass. Free trials and complimentary training do not include nutrition. The private trainer preview is a demonstration, not a subscriber purchase.

A nutrition pass costs AED 150 and a voice-guided training pass AED 100. Each is a single payment for one calendar month from confirmed payment, without automatic renewal. A pass requires paid training throughout, does not extend training, and is unusable while paid training is inactive. Check your training end date before buying. Services must be offered and ready with your trainer. Existing recurring voice subscriptions keep their agreed terms and cancellation controls.

For a monthly plan, paying for six calendar months in advance gives 10% off the full monthly price multiplied by six; paying for twelve gives 30% off the full monthly price multiplied by twelve. The total is rounded once to the nearest fils. These packs do not renew automatically. Passes and other promotions do not receive or stack with the prepaid discount. Calendar months use Dubai time and, where necessary, end on the last day of the relevant month. The purchase screen shows the total and requires acceptance of the pack terms. Existing subscriptions are not repriced by this update.

For these six- and twelve-month packs, an ordinary refund may be requested within 15 elapsed days from confirmed payment. Each month that has started is charged at the full, undiscounted monthly price agreed at purchase, including a partly used month; the refund is the amount paid less those full-price months and any refunds already made, never below zero. Access continues until the end of the retained paid month. A queued pack that has not started has no used month. For example, a six-month training pack at AED 199/month costs AED 1,074.60; a request during its first month within the 15-day window returns AED 875.60 and retains access to the end of that month. The request timestamp fixes the calculation even if processing takes longer. The 15-day window is a request deadline, not a promise that a bank completes the refund within that time. Other purchases retain their disclosed refund terms, including the ordinary seven-day request window. Use Support for statutory remedies or exceptional cases; these deadlines and deductions never reduce a remedy required by applicable law.

The existing trainer/platform revenue percentages apply to the discounted amount actually paid. Refunds reverse the corresponding share using the original charge's split. Refundable trainer earnings are held for the full 15-day prepaid refund window, and remain held while a refund is requested, pending, uncertain or requires reconciliation after failure. Settlement, payment fees, disputes and other disclosed payout checks still apply. A hold is not an additional subscriber fee.

ملحق تجاري — 14 أكتوبر 2026 للمشتريات الجديدة: الحد الأدنى الشهري هو 199 درهماً للتدريب، و299 درهماً للتدريب والتغذية، و399 درهماً للتدريب والتغذية والتوجيه الصوتي. يبدأ التدريب مع الصوت من 299 درهماً. يجوز للمدرب تحديد سعر أعلى. تتطلب التغذية اشتراك تدريب مدفوعاً سارياً وخطة تشمل التغذية أو تصريح تغذية سارياً؛ التجربة والوصول المجاني لا يشملان التغذية. معاينة المدرب الخاصة عرض تجريبي وليست عملية شراء للمشترك.

تصريح التغذية بسعر 150 درهماً وتصريح التدريب الصوتي بسعر 100 درهم، وكل منهما لشهر تقويمي واحد من تأكيد الدفع، بدفعة واحدة دون تجديد تلقائي. يلزم تدريب مدفوع طوال المدة، ولا يمدد التصريح مدة التدريب ويتوقف استخدامه إذا توقف التدريب المدفوع. تُعرض الخدمة عندما يكون المدرب جاهزاً لتقديمها. تبقى اشتراكات الصوت المتجددة الحالية على شروطها المتفق عليها.

الدفع المسبق لستة أشهر يمنح خصماً قدره 10٪ من السعر الشهري الكامل مضروباً في ستة، ولاثني عشر شهراً خصماً قدره 30٪ من السعر الشهري الكامل مضروباً في اثني عشر. يُقرب الإجمالي مرة واحدة إلى أقرب فلس. لا تتجدد الباقة تلقائياً، ولا تُجمع هذه الخصومات مع التصاريح أو العروض الأخرى. تُحسب الأشهر بتوقيت دبي مع اعتماد آخر يوم من الشهر عند الحاجة. تظهر القيمة والمدة والشروط للموافقة قبل الدفع، ولا تتغير أسعار الاشتراكات القائمة بأثر رجعي.

يمكن طلب الاسترداد العادي خلال 15 يوماً من تأكيد دفع باقة الستة أو الاثني عشر شهراً. يُخصم السعر الشهري الكامل دون خصم عن كل شهر بدأ، ولو استُخدم جزئياً، ويُرد باقي المبلغ بعد الاستردادات السابقة دون أن يقل عن صفر. يستمر الوصول حتى نهاية الشهر المحتسب. لا تُحتسب أشهر لباقة مؤجلة لم تبدأ. مثال: باقة ستة أشهر بسعر 199 درهماً شهرياً تكلف 1,074.60 درهماً؛ طلب الاسترداد خلال أول 15 يوماً يعيد 875.60 درهماً ويُبقي الوصول حتى نهاية الشهر الأول. يُعتمد وقت الطلب للحساب ولو تأخرت المعالجة؛ المهلة لتقديم الطلب وليست ضماناً لمدة معالجة البنك. للمشتريات الأخرى شروطها المعلنة، ومنها مهلة الطلب العادية البالغة سبعة أيام. تبقى حقوق المستهلك الإلزامية والتواصل مع الدعم والجهات المختصة محفوظة.

تُطبق نسب تقاسم الإيرادات القائمة على المبلغ المدفوع بعد الخصم، وتُعكس حصة الاسترداد وفق تقسيم الدفعة الأصلية. تُحجز أرباح المدرب القابلة للاسترداد طوال مهلة 15 يوماً وأثناء أي طلب أو استرداد معلق أو غير مؤكد أو يحتاج إلى تسوية بعد فشله. تبقى رسوم الدفع وشروط التسوية والنزاعات والتحويل سارية. الحجز ليس رسماً إضافياً على المشترك.$commercial$,'published',now(),publisher,publisher,now());
 INSERT INTO admin_operations_audit(id,actor_id,action,subject_id,data)
 VALUES(gen_random_uuid(),publisher,'document.published',document_id::text,jsonb_build_object('kind','legal','key','terms','version',next_version,'source','owner-authorised commerce update 2026-10-14','priorVersion',prior.version));
 INSERT INTO admin_operations_audit(id,actor_id,action,subject_id,data)
 VALUES(gen_random_uuid(),publisher,'legal.release_published','membership-2026-10-14',jsonb_build_object('ownerApproved',true,'priorAcceptances','retained','statutoryRights','preserved'));
END;
$release$;
