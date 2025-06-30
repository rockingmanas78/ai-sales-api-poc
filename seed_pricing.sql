/* ------------------------------------------------------------------
   1.  Insert the four catalogue “plans” (marketing labels)
-------------------------------------------------------------------*/
WITH ins_plan AS (
  INSERT INTO "Plan"(id, code, name)
  VALUES  (uuid_generate_v4(), 'FREE',    'Free'),
          (uuid_generate_v4(), 'STARTER', 'Starter'),
          (uuid_generate_v4(), 'GROWTH',  'Growth'),
          (uuid_generate_v4(), 'PRO',     'Pro')
  ON CONFLICT (code) DO NOTHING
  RETURNING id, code
)

/* ------------------------------------------------------------------
   2.  Helper CTE: map plan-code ➜ plan_id so we can reuse it
-------------------------------------------------------------------*/
, plan_map AS (
  SELECT code, id AS plan_id FROM ins_plan
  UNION ALL
  SELECT code, id FROM "Plan" WHERE code IN ('FREE','STARTER','GROWTH','PRO')
)

/* ------------------------------------------------------------------
   3.  Insert PlanVersion rows for every zone (version = 1, cadence = MONTHLY)
-------------------------------------------------------------------*/
, pv AS (
  INSERT INTO "PlanVersion"(
      id, planId, version, zone, bucket,
      cadence, currency, basePriceCents, createdAt
  )
  SELECT uuid_generate_v4(), p.plan_id, 1, z.zone, 'PUBLIC',
         'MONTHLY', z.currency, z.base_price, now()
  FROM plan_map p
  CROSS JOIN LATERAL (
      VALUES
        /* -----------  INDIAN RUPEE PRICE BOOK (paise)  -----------*/
        ('IN','INR', CASE p.code
                        WHEN 'FREE'    THEN    0
                        WHEN 'STARTER' THEN 149900   -- ₹1 499
                        WHEN 'GROWTH'  THEN 399900   -- ₹3 999
                        WHEN 'PRO'     THEN 799900   -- ₹7 999
                     END),
        /* ------------  UNITED STATES DOLLAR BOOK (¢) ------------*/
        ('US','USD', CASE p.code
                        WHEN 'FREE'    THEN     0
                        WHEN 'STARTER' THEN  4900    --  $49
                        WHEN 'GROWTH'  THEN  9900    --  $99
                        WHEN 'PRO'     THEN 19900    -- $199
                     END),
        /* --------------  EURO BOOK (cent)  ----------------------*/
        ('EU','EUR', CASE p.code
                        WHEN 'FREE'    THEN     0
                        WHEN 'STARTER' THEN  4900
                        WHEN 'GROWTH'  THEN  9900
                        WHEN 'PRO'     THEN 19900
                     END),
        /* -------------  UAE DIRHAM BOOK (fils) ------------------*/
        ('AE','AED', CASE p.code
                        WHEN 'FREE'    THEN     0
                        WHEN 'STARTER' THEN 18000   -- 180 AED
                        WHEN 'GROWTH'  THEN 36500   -- 365 AED
                        WHEN 'PRO'     THEN 73000   -- 730 AED
                     END)
  ) AS z(zone,currency,base_price)
  ON CONFLICT (planId, zone, bucket, cadence, version) DO NOTHING
  RETURNING id, zone, planId
)

/* ------------------------------------------------------------------
   4.  Insert the metric components (caps + overage) for every version
-------------------------------------------------------------------*/
, comp AS (
  INSERT INTO "Component"(id, planVersionId, metric, includedQty, capPeriod, overageCents)
  SELECT uuid_generate_v4(), pv.id,
         c.metric, c.incl, c.period, c.over
  FROM pv
  CROSS JOIN LATERAL (
        VALUES
          /* JOBS per DAY */
          ('JOB', CASE
                    WHEN (SELECT code FROM \"Plan\" WHERE id=pv.planId)='FREE'    THEN  3
                    WHEN (SELECT code FROM \"Plan\" WHERE id=pv.planId)='STARTER' THEN 10
                    WHEN (SELECT code FROM \"Plan\" WHERE id=pv.planId)='GROWTH'  THEN 30
                    ELSE -1  -- PRO unlimited
                  END,
                  'DAY',
                  CASE pv.zone
                       WHEN 'IN' THEN 2000  -- ₹20 == 2 000 paise
                       WHEN 'US' THEN   50  -- $0.50 == 50 ¢
                       WHEN 'EU' THEN   50  -- €0.50 == 50 cent
                       WHEN 'AE' THEN  200  -- 2 AED == 200 fils
                  END ),
          /* CLASSIFICATIONS per MONTH */
          ('CLASSIFICATION', CASE
                    WHEN (SELECT code FROM \"Plan\" WHERE id=pv.planId)='FREE'    THEN  1000
                    WHEN (SELECT code FROM \"Plan\" WHERE id=pv.planId)='STARTER' THEN  5000
                    WHEN (SELECT code FROM \"Plan\" WHERE id=pv.planId)='GROWTH'  THEN 20000
                    ELSE -1
                  END,
                  'MONTH',
                  CASE pv.zone
                       WHEN 'IN' THEN  100 -- ₹1 == 100 paise
                       WHEN 'US' THEN    2 -- $0.02 == 2 ¢
                       WHEN 'EU' THEN    2 -- €0.02 == 2 cent
                       WHEN 'AE' THEN    7 -- 0.07 AED == 7 fils
                  END ),
          /* SEATS per BILLING PERIOD */
          ('SEAT', CASE
                    WHEN (SELECT code FROM \"Plan\" WHERE id=pv.planId)='FREE'    THEN 1
                    WHEN (SELECT code FROM \"Plan\" WHERE id=pv.planId)='STARTER' THEN 5
                    WHEN (SELECT code FROM \"Plan\" WHERE id=pv.planId)='GROWTH'  THEN 10
                    ELSE -1
                   END,
                   'PERIOD',
                   0  -- no overage seat-billing (adjust later if needed)
          )
  ) AS c(metric,incl,period,over)
  ON CONFLICT DO NOTHING
)

/* ------------------------------------------------------------------
   5.  Placeholder gateway price IDs (one per PlanVersion)
       – replace with the real IDs once you create them in Razorpay
         or Stripe dashboard, then rerun UPDATE statements.
-------------------------------------------------------------------*/
INSERT INTO "PriceId"(id, planVersionId, gateway, price, externalPriceId)
SELECT uuid_generate_v4(), pv.id,
       CASE pv.zone WHEN 'IN' THEN 'RAZORPAY' ELSE 'STRIPE' END,
       'MONTHLY',
       concat(lower((SELECT code FROM \"Plan\" WHERE id = pv.planId)), '_', lower(pv.zone), '_v1')
FROM pv
ON CONFLICT DO NOTHING;

-- verify
SELECT p.code, pv.zone, pv.basePriceCents, count(c.*) AS components
FROM "PlanVersion" pv
JOIN "Plan" p ON p.id = pv.planId
LEFT JOIN "Component" c ON c.planVersionId = pv.id
GROUP BY p.code, pv.zone, pv.basePriceCents
ORDER BY p.code, pv.zone;
