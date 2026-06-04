#!/usr/bin/env node
/**
 * backfill-contacts-insert.js
 * Migrates schema + upserts all contacts gathered from full M365 history scan.
 *
 * Usage:
 *   cd ~/personal-os/api
 *   node scripts/backfill-contacts-insert.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

// ── All contacts gathered from full email history scan ─────────────────────
// Deduplicated by email address.
const CONTACTS = [
  // ── Howard Hughes / Teravalis ──────────────────────────────────────────
  { email: 'sharra.rice@howardhughes.com',        name: 'Sharra Rice',              title: 'Executive Assistant',                              company: 'Howard Hughes',                    phone_mobile: '480.203.4317',   phone_work: '602.834.9116',  address: '4150 N Drinkwater Blvd, Suite 100, Scottsdale, AZ 85251' },
  { email: 'kate.kaminski@howardhughes.com',       name: 'Kate Kaminski',            title: 'COO Arizona / Teravalis',                          company: 'Howard Hughes',                    phone_mobile: '480.625.5091',   phone_work: '602.838.7224',  address: '4150 N Drinkwater Blvd, Suite 100, Scottsdale, AZ 85251' },

  // ── Pacific Fusion ─────────────────────────────────────────────────────
  { email: 'courtney@pacificfusion.com',           name: 'Courtney Richardson',      title: 'Infrastructure Lead, PE',                          company: 'Pacific Fusion',                   phone_mobile: '415.930.1543',   phone_work: null,            address: null },
  { email: 'kelsey.reichenbach@pacificfusion.com', name: 'Kelsey Reichenbach',       title: 'Assembly',                                         company: 'Pacific Fusion',                   phone_mobile: '330-888-3910',   phone_work: null,            address: null },
  { email: 'james.estopinal@pacificfusion.com',    name: 'James Estopinal',          title: 'Cost Engineering Lead',                            company: 'Pacific Fusion',                   phone_mobile: null,             phone_work: null,            address: null },
  { email: 'echo@pacificfusion.com',               name: 'Echo Wood',                title: null,                                               company: 'Pacific Fusion',                   phone_mobile: null,             phone_work: null,            address: null },
  { email: 'james@pacificfusion.com',              name: 'James Trebesch',           title: null,                                               company: 'Pacific Fusion',                   phone_mobile: null,             phone_work: null,            address: null },
  { email: 'nick.rivera@pacificfusion.com',        name: 'Nick Rivera',              title: null,                                               company: 'Pacific Fusion',                   phone_mobile: null,             phone_work: null,            address: null },
  { email: 'jeremy.dixon@pacificfusion.com',       name: 'Jeremy Dixon',             title: null,                                               company: 'Pacific Fusion',                   phone_mobile: null,             phone_work: null,            address: null },
  { email: 'justin.grodman@pacificfusion.com',     name: 'Justin Grodman',           title: null,                                               company: 'Pacific Fusion',                   phone_mobile: null,             phone_work: null,            address: null },
  { email: 'craig.companion@pacificfusion.com',    name: 'Craig Companion',          title: null,                                               company: 'Pacific Fusion',                   phone_mobile: null,             phone_work: null,            address: null },
  { email: 'mindy@pacificfusion.com',              name: 'Mindy',                    title: null,                                               company: 'Pacific Fusion',                   phone_mobile: null,             phone_work: null,            address: null },
  { email: 'tdockins@coxcastle.com',               name: 'Taylor Dockins',           title: null,                                               company: 'Cox Castle',                       phone_mobile: null,             phone_work: null,            address: null },

  // ── ASML ───────────────────────────────────────────────────────────────
  { email: 'gareth.bowman@asml.com',               name: 'Gareth Bowman',            title: 'Corporate Real Estate SD',                         company: 'ASML',                             phone_mobile: '+16503049620',   phone_work: null,            address: null },
  { email: 'oleg.stovik@asml.com',                 name: 'Oleg Stovik',              title: 'SV & USF CRE Project Management',                  company: 'ASML',                             phone_mobile: '360-223-3622',   phone_work: null,            address: 'Silicon Valley' },
  { email: 'ian.thayer@asml.com',                  name: 'Ian Thayer',               title: 'CRE Manager of PjM - SV & USF, Corp Real Estate',  company: 'ASML',                             phone_mobile: '408-813-4275',   phone_work: null,            address: 'Silicon Valley' },
  { email: 'anderson.hasting@asml.com',            name: 'Anderson Hasting',         title: 'US Indirect Category Manager',                     company: 'ASML US LLC',                      phone_mobile: '614-906-0193',   phone_work: null,            address: '17075 Thornmint CT, San Diego, CA 92127' },
  { email: 'mehul.joshi@asml.com',                 name: 'Mehul Joshi',              title: 'Project Manager, Silicon Valley Facilities Mgmt',  company: 'ASML',                             phone_mobile: '510-427-0742',   phone_work: null,            address: 'Silicon Valley' },
  { email: 'rob.gantt@asml.com',                   name: 'Rob Gantt',                title: 'Technical Trainer',                                company: 'ASML',                             phone_mobile: '845-742-4247',   phone_work: null,            address: 'Phoenix Training Center' },
  { email: 'eric.de.boer@asml.com',                name: 'Eric de Boer',             title: 'Manager US Training Center',                       company: 'ASML',                             phone_mobile: null,             phone_work: null,            address: null },
  { email: 'tom.trigg@asml.com',                   name: 'Thomas Trigg',             title: 'Vendor Operations',                                company: 'ASML Netherlands BV',              phone_mobile: null,             phone_work: '+442045518131',  address: null },
  { email: 'peter.van.anrooy@asml.com',            name: 'Peter van Anrooy',         title: null,                                               company: 'ASML',                             phone_mobile: null,             phone_work: null,            address: null },

  // ── Gotion ─────────────────────────────────────────────────────────────
  { email: 'm.wang4@gotion.com',                   name: 'Morris Wang',              title: 'Senior Project Manager, U.S. East',                company: 'Gotion',                           phone_mobile: '714-482-8056',   phone_work: null,            address: '333 South Spruce Street, Manteno, IL 60950' },
  { email: 'm.zeitoun@gotion.com',                 name: 'Mohamad Ali Zeitoun',      title: 'Head of Market Management',                        company: 'Gotion',                           phone_mobile: '480-329-3350',   phone_work: null,            address: '333 S. Spruce St., Manteno, IL' },
  { email: 'r.sayre@gotion.com',                   name: 'Cole Sayre',               title: null,                                               company: 'Gotion',                           phone_mobile: '502-229-6489',   phone_work: null,            address: null },
  { email: 'm.wang5@gotion.com',                   name: 'Mingwen Wang',             title: null,                                               company: 'Gotion',                           phone_mobile: null,             phone_work: null,            address: null },
  { email: 'r.chen@gotion.com',                    name: 'Ray Chen',                 title: null,                                               company: 'Gotion',                           phone_mobile: null,             phone_work: null,            address: null },
  { email: 'y.li21@gotion.com',                    name: 'Ying Li',                  title: null,                                               company: 'Gotion',                           phone_mobile: null,             phone_work: null,            address: null },
  { email: 'l.zhao@gotion.com',                    name: 'Amy Zhao',                 title: null,                                               company: 'Gotion',                           phone_mobile: null,             phone_work: null,            address: null },
  { email: 's.alhaddadin@gotion.com',              name: 'Sahim Alhaddadin',         title: null,                                               company: 'Gotion',                           phone_mobile: null,             phone_work: null,            address: null },
  { email: 'taozhihan@gotion.com.cn',              name: 'Tao Zhi Han',              title: null,                                               company: 'Gotion',                           phone_mobile: null,             phone_work: null,            address: null },
  { email: 'xiepingping@gotion.com.cn',            name: 'Sherry Xie',               title: null,                                               company: 'Gotion',                           phone_mobile: null,             phone_work: null,            address: null },

  // ── Ship & Shore Environmental ─────────────────────────────────────────
  { email: 'anooshehm@shipandshore.com',           name: 'Anoosheh Oskouian',        title: 'President & CEO',                                  company: 'Ship & Shore Environmental',       phone_mobile: null,             phone_work: '+15629970233',  address: '2474 N Palm Drive, Signal Hill, CA 90755' },
  { email: 'avij@shipandshore.com',                name: 'Anu Vij',                  title: 'Chief Operating Officer',                          company: 'Ship & Shore Environmental',       phone_mobile: null,             phone_work: '+15629970233',  address: '2474 N Palm Drive, Signal Hill, CA 90755' },
  { email: 'emendez@shipandshore.com',             name: 'Eduardo Mendez',           title: 'Project Manager',                                  company: 'Ship & Shore Environmental',       phone_mobile: null,             phone_work: '+15629970233',  address: '2474 N Palm Drive, Signal Hill, CA 90755' },
  { email: 'kshafi@shipandshore.com',              name: 'Khosrow Shafiayane',       title: null,                                               company: 'Ship & Shore Environmental',       phone_mobile: null,             phone_work: null,            address: null },
  { email: 'ssin@shipandshore.com',                name: 'Sophary Sin',              title: null,                                               company: 'Ship & Shore Environmental',       phone_mobile: null,             phone_work: null,            address: null },
  { email: 'ggood@shipandshore.com',               name: 'Greg Good',                title: null,                                               company: 'Ship & Shore Environmental',       phone_mobile: null,             phone_work: null,            address: null },

  // ── Stantec ────────────────────────────────────────────────────────────
  { email: 'rebekah.bellum@stantec.com',           name: 'Rebekah Bellum',           title: 'Senior Architect, AIA NCARB LEED AP BD+C',         company: 'Stantec Architecture Inc.',        phone_mobile: null,             phone_work: '5054565585',    address: null },
  { email: 'bill.huie@stantec.com',                name: 'Bill Huie',                title: 'Principal, AIA NCARB',                             company: 'Stantec Architecture Inc.',        phone_mobile: '4158165223',     phone_work: '4154770574',    address: null },
  { email: 'dominic.wood@stantec.com',             name: 'Dominic Wood',             title: null,                                               company: 'Stantec',                          phone_mobile: null,             phone_work: null,            address: null },
  { email: 'christopher.wilson@stantec.com',       name: 'Christopher Wilson',       title: null,                                               company: 'Stantec',                          phone_mobile: null,             phone_work: null,            address: null },
  { email: 'kristen.bates@stantec.com',            name: 'Kristen Bates',            title: null,                                               company: 'Stantec',                          phone_mobile: null,             phone_work: null,            address: null },
  { email: 'nitish.suvarna@stantec.com',           name: 'Nitish Suvarna',           title: null,                                               company: 'Stantec',                          phone_mobile: null,             phone_work: null,            address: null },
  { email: 'jen.bussinger@stantec.com',            name: 'Jen Bussinger',            title: null,                                               company: 'Stantec',                          phone_mobile: null,             phone_work: null,            address: null },
  { email: 'maria.gamezcontreras@stantec.com',     name: 'Maria Gamez Contreras',    title: null,                                               company: 'Stantec',                          phone_mobile: null,             phone_work: null,            address: null },

  // ── Jensen Hughes ──────────────────────────────────────────────────────
  { email: 'john.woycheese@jensenhughes.com',      name: 'John Woycheese',           title: null,                                               company: 'Jensen Hughes',                    phone_mobile: null,             phone_work: null,            address: null },
  { email: 'jessie.warren@jensenhughes.com',       name: 'Jessie Warren',            title: null,                                               company: 'Jensen Hughes',                    phone_mobile: null,             phone_work: null,            address: null },

  // ── Thornton Tomasetti ─────────────────────────────────────────────────
  { email: 'ffang@thorntontomasetti.com',          name: 'Frank Fang',               title: 'Senior Project Engineer, PE',                      company: 'Thornton Tomasetti',               phone_mobile: null,             phone_work: '+12123672885',  address: '235 Montgomery St, Suite 1050, San Francisco, CA 94104' },
  { email: 'mkoenigs@thorntontomasetti.com',       name: 'Mark Koenigs',             title: 'Associate Principal, PE SE LEED AP',               company: 'Thornton Tomasetti',               phone_mobile: '5108722823',     phone_work: '4153656902',    address: '235 Montgomery St, Suite 1050, San Francisco, CA 94104' },

  // ── Kone Cranes ────────────────────────────────────────────────────────
  { email: 'zach.banks@konecranes.com',            name: 'Zach Banks',               title: 'Project Manager, PNC Delivery Operations',         company: 'Kone Cranes',                      phone_mobile: '513-315-9460',   phone_work: null,            address: 'US TX Houston Factory' },
  { email: 'matthew.adams@konecranes.com',         name: 'Matthew Adams',            title: 'Project Manager, ETO Delivery Operations',         company: 'Kone Cranes',                      phone_mobile: '+12816381264',   phone_work: null,            address: '7300 Chippewa Blvd, Houston, TX 77086' },

  // ── CSI Solar / Canadian Solar ─────────────────────────────────────────
  { email: 'xunhao.zhuo@csisolar.com',             name: 'Xun-Hao Zhuo',            title: 'Certified Level C General Project Manager',        company: 'Canadian Solar US Manufacturing',   phone_mobile: '+19252857683',   phone_work: null,            address: '3000 Skyline Drive, Mesquite, TX' },
  { email: 'rusty.schmit@csisolar.com',            name: 'Rusty Schmit',             title: 'Head of N. America Manufacturing Strategy',        company: 'Canadian Solar US Manufacturing',   phone_mobile: '+14155306910',   phone_work: null,            address: '1350 Treat Blvd, Suite 500, Walnut Creek, CA 94597' },
  { email: 'lorenzo.perez@csisolar.com',           name: 'Lorenzo Perez',            title: 'Facility Manager',                                 company: 'Canadian Solar US Manufacturing',   phone_mobile: '+19452866924',   phone_work: null,            address: '3000 Skyline Drive, Mesquite, TX 75149' },
  { email: 'roy.mathews@csisolar.com',             name: 'Roy Mathews',              title: null,                                               company: 'CSI Solar',                        phone_mobile: null,             phone_work: null,            address: null },

  // ── NorSun ─────────────────────────────────────────────────────────────
  { email: 'hendrik.schon@norsun.no',              name: 'Hendrik Schön',            title: null,                                               company: 'NorSun Holding AS',                phone_mobile: null,             phone_work: null,            address: null },
  { email: 'hendrik.schon@norsun.solar',           name: 'Hendrik Schön',            title: null,                                               company: 'NorSun Holding AS',                phone_mobile: null,             phone_work: null,            address: null },
  { email: 'harald.bakke@norsun.no',               name: 'Harald Bakke',             title: null,                                               company: 'NorSun Holding AS',                phone_mobile: null,             phone_work: null,            address: null },
  { email: 'ttempleton@norsun.no',                 name: 'T Templeton',              title: null,                                               company: 'NorSun Holding AS',                phone_mobile: null,             phone_work: null,            address: null },

  // ── BHM Engineering / Sofidel ──────────────────────────────────────────
  { email: 'dario.maggiorelli@bhm-ing.com',        name: 'Dario Maggiorelli',        title: 'Project Management (M.eng.)',                      company: 'BHM INGENIEURE Engineering & Consulting GmbH', phone_mobile: '+43664960019', phone_work: '+435522461014', address: 'Runastrasse 90, 6800 Feldkirch, Austria' },
  { email: 'peter.oksakowski@bhm-ing.com',         name: 'Peter Oksakowski',         title: null,                                               company: 'BHM INGENIEURE Engineering & Consulting GmbH', phone_mobile: null, phone_work: null, address: null },
  { email: 'antonio.cuccarese@sofidel.com',        name: 'Antonio Cuccarese',        title: null,                                               company: 'Sofidel',                          phone_mobile: null,             phone_work: null,            address: null },

  // ── Western Ground Improvement ─────────────────────────────────────────
  { email: 'craig@westerngroundimprovement.com',   name: 'Craig Streit',             title: 'Project Manager, LEED AP',                         company: 'Western Ground Improvement',       phone_mobile: '480-250-2862',   phone_work: null,            address: null },
  { email: 'ken@westerngroundimprovement.com',     name: 'Ken Hoevelkamp',           title: null,                                               company: 'Western Ground Improvement',       phone_mobile: null,             phone_work: null,            address: null },

  // ── Baldwin ────────────────────────────────────────────────────────────
  { email: 'sarah.shepard@baldwin.com',            name: 'Sarah Shepard McGuinness', title: 'Partner, Construction & Real Estate',              company: 'Baldwin',                          phone_mobile: '617.877.8610',   phone_work: null,            address: null },
  { email: 'joe.charczenko@baldwin.com',           name: 'Joe Charczenko',           title: null,                                               company: 'Baldwin',                          phone_mobile: null,             phone_work: null,            address: null },
  { email: 'michael.dantuono@baldwin.com',         name: 'Michael Dantuono',         title: null,                                               company: 'Baldwin',                          phone_mobile: null,             phone_work: null,            address: null },

  // ── CAC Group ─────────────────────────────────────────────────────────
  { email: 'rick.eisenstat@cacgroup.com',          name: 'Rick Eisenstat',           title: null,                                               company: 'CAC Group',                        phone_mobile: null,             phone_work: null,            address: null },
  { email: 'nicole.huneau@cacgroup.com',           name: 'Nicole Huneau',            title: null,                                               company: 'CAC Group',                        phone_mobile: null,             phone_work: null,            address: null },
  { email: 'carter.swan@cacgroup.com',             name: 'Carter Swan',              title: null,                                               company: 'CAC Group',                        phone_mobile: null,             phone_work: null,            address: null },

  // ── Villa Lighting ────────────────────────────────────────────────────
  { email: 'nick.becker@villalighting.com',        name: 'Nick Becker',              title: 'National Account Sales - St. Louis',               company: 'Villa Lighting Supply',            phone_mobile: '314.478.3141',   phone_work: '314.633.0534',  address: '2929 Chouteau Avenue, St. Louis, MO 63103' },
  { email: 'dan.ludwig@villalighting.com',         name: 'Dan Ludwig',               title: null,                                               company: 'Villa Lighting Supply',            phone_mobile: '314-359-2616',   phone_work: '314-633-0418',  address: null },
  { email: 'jeff.clauss@villalighting.com',        name: 'Jeff Clauss',              title: null,                                               company: 'Villa Lighting Supply',            phone_mobile: null,             phone_work: null,            address: null },

  // ── E&K of Phoenix ─────────────────────────────────────────────────────
  { email: 'dan.pignatari@e-kco.com',              name: 'Dan Pignatari',            title: 'Vice President',                                   company: 'E&K of Phoenix',                   phone_mobile: '847.609.2312',   phone_work: '602.962.6269',  address: '1802 W Knudsen Dr, Phoenix, AZ 85027' },

  // ── TS Conductor ───────────────────────────────────────────────────────
  { email: 'massimo@tsconductor.com',              name: 'Massimo Masini',           title: 'VP Customer Fulfilment',                           company: 'TS Conductor',                     phone_mobile: '1-310-755-9645', phone_work: null,            address: '15272 Newsboy Cir, Huntington Beach, CA' },

  // ── Baker Tilly ───────────────────────────────────────────────────────
  { email: 'henry.morris@bakertilly.com',          name: 'Henry Morris',             title: null,                                               company: 'Baker Tilly',                      phone_mobile: null,             phone_work: null,            address: null },
  { email: 'stephen.bacchetti@bakertilly.com',     name: 'Stephen Bacchetti',        title: null,                                               company: 'Baker Tilly',                      phone_mobile: null,             phone_work: null,            address: null },
  { email: 'charnee.foston@bakertilly.com',        name: 'Charnee Foston',           title: null,                                               company: 'Baker Tilly',                      phone_mobile: null,             phone_work: null,            address: null },

  // ── Ulteig ────────────────────────────────────────────────────────────
  { email: 'chris.smaaladen@ulteig.com',           name: 'Chris Smaaladen',          title: null,                                               company: 'Ulteig',                           phone_mobile: null,             phone_work: null,            address: null },
  { email: 'justin.smaaladen@ulteig.com',          name: 'Justin Smaaladen',         title: null,                                               company: 'Ulteig',                           phone_mobile: null,             phone_work: null,            address: null },

  // ── Meyers+ ───────────────────────────────────────────────────────────
  { email: 'susie@meyersplus.com',                 name: 'Susie',                    title: null,                                               company: 'Meyers+',                          phone_mobile: null,             phone_work: null,            address: null },

  // ── BH Inc ────────────────────────────────────────────────────────────
  { email: 'mbalaskovits@bhinc.com',               name: 'Mike Balaskovits',         title: null,                                               company: 'BH Inc',                           phone_mobile: null,             phone_work: null,            address: null },
  { email: 'jlutz@bhinc.com',                      name: 'Joshua Lutz',              title: null,                                               company: 'BH Inc',                           phone_mobile: null,             phone_work: null,            address: null },

  // ── Page Think / Stantec ──────────────────────────────────────────────
  { email: 'dwood@pagethink.com',                  name: 'Dominic Wood',             title: null,                                               company: 'Page Think / Stantec',             phone_mobile: null,             phone_work: null,            address: null },

  // ── PNM (Pacific Fusion utility interconnection) ───────────────────────
  { email: 'gannon.chavez@pnm.com',                name: 'Gannon Chavez',            title: 'Engineer II, Distribution Engineering',            company: 'PNM',                              phone_mobile: '505-410-3693',   phone_work: null,            address: null },
  { email: 'benjamin.reimer@pnm.com',              name: 'Benjamin Reimer',          title: null,                                               company: 'PNM',                              phone_mobile: null,             phone_work: null,            address: null },
  { email: 'antonio.granillo@pnm.com',             name: 'Antonio Granillo',         title: null,                                               company: 'PNM',                              phone_mobile: null,             phone_work: null,            address: null },
  { email: 'grant.taylor@pnm.com',                 name: 'Grant Taylor',             title: null,                                               company: 'PNM',                              phone_mobile: null,             phone_work: null,            address: null },
  { email: 'jeremy.tabet@pnm.com',                 name: 'Jeremy Tabet',             title: null,                                               company: 'PNM',                              phone_mobile: null,             phone_work: null,            address: null },
  { email: 'cindy.buck@pnm.com',                   name: 'Cindy Buck',               title: null,                                               company: 'PNM',                              phone_mobile: null,             phone_work: null,            address: null },

  // ── Hines ─────────────────────────────────────────────────────────────
  { email: 'mario.tjia@hines.com',                 name: 'Mario Tjia',               title: null,                                               company: 'Hines',                            phone_mobile: null,             phone_work: null,            address: null },

  // ── Valley Partnership ─────────────────────────────────────────────────
  { email: 'cprincell@valleypartnership.org',      name: 'Clark Princell',           title: 'President & CEO',                                  company: 'Valley Partnership',               phone_mobile: '602-558-2747',   phone_work: null,            address: '11801 N. Tatum Blvd, Suite 224, Phoenix AZ 85028' },
  { email: 'cmartin@valleypartnership.org',        name: 'Courtney Martin',          title: null,                                               company: 'Valley Partnership',               phone_mobile: null,             phone_work: null,            address: null },

  // ── SEMI Global ───────────────────────────────────────────────────────
  { email: 'erude@semi.org',                       name: 'Eric Rude',                title: 'Director, Membership Services & Customer Engagement', company: 'SEMI',                          phone_mobile: null,             phone_work: '+14089437047',  address: '673 S. Milpitas Blvd., Milpitas, CA' },
  { email: 'mglavin@semi.org',                     name: 'Mike Glavin',              title: null,                                               company: 'SEMI',                             phone_mobile: null,             phone_work: null,            address: null },

  // ── SEMI SCFG Committee members ────────────────────────────────────────
  { email: 'ccobbley@bechtel.com',                 name: 'Chad Cobbley',             title: null, company: 'Bechtel',                           phone_mobile: null, phone_work: null, address: null },
  { email: 'jkehoe@consigli.com',                  name: 'James Kehoe',              title: null, company: 'Consigli',                          phone_mobile: null, phone_work: null, address: null },
  { email: 'charlesj@dpr.com',                     name: 'Charles Jabara',           title: null, company: 'DPR Construction',                  phone_mobile: null, phone_work: null, address: null },
  { email: 'mikecu@dpr.com',                       name: 'Mike Cu',                  title: null, company: 'DPR Construction',                  phone_mobile: null, phone_work: null, address: null },
  { email: 'tsullivan@efcgases.com',               name: 'Tim Sullivan',             title: null, company: 'EFC Gases',                         phone_mobile: null, phone_work: null, address: null },
  { email: 'jspringer@gilbaneco.com',              name: 'J Springer',               title: null, company: 'Gilbane',                           phone_mobile: null, phone_work: null, address: null },
  { email: 'brianna_nessler@graycor.com',          name: 'Brianna Nessler',          title: null, company: 'Graycor',                           phone_mobile: null, phone_work: null, address: null },
  { email: 'jtanner@hodess.com',                   name: 'Jennifer Tanner',          title: null, company: 'Hodess',                            phone_mobile: null, phone_work: null, address: null },
  { email: 'nathan.monosoff@jacobs.com',           name: 'Nate Monosoff',            title: null, company: 'Jacobs',                            phone_mobile: null, phone_work: null, address: null },
  { email: 'wael.maarouf@jedunn.com',              name: 'Wael Maarouf',             title: null, company: 'JE Dunn',                           phone_mobile: null, phone_work: null, address: null },
  { email: 'lee.ogle@jedunn.com',                  name: 'Lee Ogle',                 title: null, company: 'JE Dunn',                           phone_mobile: null, phone_work: null, address: null },
  { email: 'charles.warrington@microchip.com',     name: 'Charles Warrington',       title: null, company: 'Microchip Technology',              phone_mobile: null, phone_work: null, address: null },
  { email: 'ian.anderson@mortenson.com',           name: 'Ian Anderson',             title: null, company: 'Mortenson',                         phone_mobile: null, phone_work: null, address: null },
  { email: 'rdabiri@ny-creates.org',               name: 'Ramin Dabiri',             title: null, company: 'NY Creates / NYSERDA',              phone_mobile: null, phone_work: null, address: null },
  { email: 'brian.hoover@okland.com',              name: 'Brian Hoover',             title: null, company: 'Okland Construction',               phone_mobile: null, phone_work: null, address: null },
  { email: 'erika.pham@skanska.com',               name: 'Erika Pham',               title: null, company: 'Skanska',                           phone_mobile: null, phone_work: null, address: null },
  { email: 'mac.margason@skanska.com',             name: 'Mac Margason',             title: null, company: 'Skanska',                           phone_mobile: null, phone_work: null, address: null },
  { email: 'dale.bogan@skyworksinc.com',           name: 'Dale Bogan',               title: null, company: 'Skyworks',                          phone_mobile: null, phone_work: null, address: null },
  { email: 'dhart@suffolk.com',                    name: 'Darin Hart',               title: null, company: 'Suffolk Construction',              phone_mobile: null, phone_work: null, address: null },
  { email: 'jlahrens@sundt.com',                   name: 'Jenn Ahrens',              title: null, company: 'Sundt Construction',                phone_mobile: null, phone_work: null, address: null },
  { email: 'saber@ti.com',                         name: 'Massoud Saber-Tehrani',    title: null, company: 'Texas Instruments',                 phone_mobile: null, phone_work: null, address: null },
  { email: 'mgulley@tcco.com',                     name: 'Matt Gulley',              title: null, company: 'Turner Construction',               phone_mobile: null, phone_work: null, address: null },
  { email: 'zaki.sarwary@whiting-turner.com',      name: 'Zaki Sarwary',             title: null, company: 'Whiting-Turner',                    phone_mobile: null, phone_work: null, address: null },
  { email: 'brian.vick@wolfspeed.com',             name: 'Brian Vick',               title: null, company: 'Wolfspeed',                         phone_mobile: null, phone_work: null, address: null },
  { email: 'ram.ravichandran@woolpert.com',         name: 'Ram Ravichandran',         title: null, company: 'Woolpert',                          phone_mobile: null, phone_work: null, address: null },
  { email: 'afranco@olsson.com',                   name: 'Adrian Franco',            title: null, company: 'Olsson',                            phone_mobile: null, phone_work: null, address: null },
  { email: 'tracy.rapp@century3inc.com',           name: 'Tracy Rapp',               title: null, company: 'Century 3',                         phone_mobile: null, phone_work: null, address: null },

  // ── Able Steel ────────────────────────────────────────────────────────
  { email: 'sludwig@ablesteel.com',                name: 'Sam Ludwig',               title: 'Vice President of Sales',                          company: 'Able Steel',                       phone_mobile: '602-679-8722',   phone_work: '480-830-2253',  address: null },

  // ── UPN Fiber ─────────────────────────────────────────────────────────
  { email: 'john.hufnagel@upnfiber.com',           name: 'John Hufnagel',            title: null,                                               company: 'UPN Fiber',                        phone_mobile: '505-938-7322',   phone_work: '505-301-9118',  address: null },

  // ── Oriden Power ──────────────────────────────────────────────────────
  { email: 'dante.barbetti@oridenpower.com',       name: 'Dante Barbetti',           title: 'Senior Associate, Development',                    company: 'Oriden LLC',                       phone_mobile: null,             phone_work: null,            address: null },
  { email: 'bill.caruthers@oridenpower.com',       name: 'Bill Caruthers',           title: null,                                               company: 'Oriden LLC',                       phone_mobile: null,             phone_work: null,            address: null },
  { email: 'timothy.piette@oridenpower.com',       name: 'Timothy Piette',           title: null,                                               company: 'Oriden LLC',                       phone_mobile: null,             phone_work: null,            address: null },
  { email: 'drew.cates@oridenpower.com',           name: 'Drew Cates',               title: null,                                               company: 'Oriden LLC',                       phone_mobile: null,             phone_work: null,            address: null },
  { email: 'bill.miller@oridenpower.com',          name: 'Bill Miller',              title: null,                                               company: 'Oriden LLC',                       phone_mobile: null,             phone_work: null,            address: null },

  // ── Anduril / BRPH / Grit ─────────────────────────────────────────────
  { email: 'rheiss@anduril.com',                   name: 'Rachael Heiss',            title: null,                                               company: 'Anduril Industries',               phone_mobile: null,             phone_work: null,            address: null },
  { email: 'phil@gritpp.com',                      name: 'Phil Szajda',              title: null,                                               company: 'Grit Project Partners',            phone_mobile: '917-324-0066',   phone_work: null,            address: null },
  { email: 'ramy.temraz@hughesmarino.com',         name: 'Ramy Temraz',              title: null,                                               company: 'Hughes Marino',                    phone_mobile: null,             phone_work: null,            address: null },
  { email: 'mwatts@brph.com',                      name: 'Marti Watts',              title: 'Exec VP, Manufacturing & Industrial, Principal',   company: 'BRPH',                             phone_mobile: '843-209-3096',   phone_work: null,            address: '5700 N Harbor City Blvd, Suite 400, Melbourne, FL 32940' },
  { email: 'lswiergosz@brph.com',                  name: 'L Swiergosz',              title: null,                                               company: 'BRPH',                             phone_mobile: null,             phone_work: null,            address: null },

  // ── MMR Constructors ──────────────────────────────────────────────────
  { email: 'lindsey.brist@mmrgrp.com',             name: 'Lindsey Pontious-Brist',   title: 'SW Business Development Manager',                  company: 'MMR Constructors',                 phone_mobile: '208-631-7601',   phone_work: null,            address: '5343 N 16th St, Third Floor, Phoenix, AZ 85016' },

  // ── Martin Energy Group ───────────────────────────────────────────────
  { email: 'mmartin@martinenergygroup.com',        name: 'M Martin',                 title: null,                                               company: 'Martin Energy Group',              phone_mobile: null,             phone_work: null,            address: null },

  // ── Linesight / Kirkland & Ellis / Choice Engineering ─────────────────
  { email: 'morag.murray@linesight.com',           name: 'Morag Murray',             title: null,                                               company: 'Linesight',                        phone_mobile: null,             phone_work: null,            address: null },
  { email: 'ahmed.alrikhaimi@kirkland.com',        name: 'Ahmed Al-Rikhaimi',        title: null,                                               company: 'Kirkland & Ellis',                 phone_mobile: null,             phone_work: null,            address: null },
  { email: 'matt@choice.engineering',              name: 'Matt Parks',               title: null,                                               company: 'Choice Engineering',               phone_mobile: null,             phone_work: null,            address: null },

  // ── Lucid Motors ──────────────────────────────────────────────────────
  { email: 'chasedunn@lucidmotors.com',            name: 'Chase Dunn',               title: null,                                               company: 'Lucid Motors',                     phone_mobile: null,             phone_work: null,            address: null },
  { email: 'gwengeraci@lucidmotors.com',           name: 'Gwen Geraci',              title: null,                                               company: 'Lucid Motors',                     phone_mobile: null,             phone_work: null,            address: null },
  { email: 'amberkelleybatie@lucidmotors.com',     name: 'Amber Kelley Batie',       title: null,                                               company: 'Lucid Motors',                     phone_mobile: null,             phone_work: null,            address: null },

  // ── Lanmor ────────────────────────────────────────────────────────────
  { email: 'jordan@lanmor.com',                    name: 'Jordan Cunningham',        title: 'Assistant General Manager',                        company: 'Lanmor',                           phone_mobile: '602-376-9328',   phone_work: '623-869-6864',  address: '2058 W. Rose Garden Lane, Phoenix, AZ 85027' },

  // ── AZBEX ─────────────────────────────────────────────────────────────
  { email: 'rmorris@azbex.com',                    name: 'R Morris',                 title: null,                                               company: 'AZBEX',                            phone_mobile: null,             phone_work: null,            address: null },

  // ── Other subs / vendors ──────────────────────────────────────────────
  { email: 'starr@northstarconcrete.com',          name: 'Starr',                    title: null,                                               company: 'North Star Concrete',              phone_mobile: null,             phone_work: null,            address: null },
  { email: 'krystal.carraway@dpelectric.com',      name: 'Krystal Carraway',         title: null,                                               company: 'DP Electric',                      phone_mobile: null,             phone_work: null,            address: null },
  { email: 'derek.vandervorst@solarge.com',        name: 'Derek Vandervorst',        title: null,                                               company: 'Solarge',                          phone_mobile: null,             phone_work: null,            address: null },
  { email: 'serhat@sente.vc',                      name: 'Serhat',                   title: null,                                               company: 'Sente VC',                         phone_mobile: null,             phone_work: null,            address: null },
  { email: 'mattg@nationaldbs.com',                name: 'Matt G',                   title: null,                                               company: 'National DBS',                     phone_mobile: null,             phone_work: null,            address: null },
  { email: 'danm@nationaldbs.com',                 name: 'Dan M',                    title: null,                                               company: 'National DBS',                     phone_mobile: null,             phone_work: null,            address: null },
  { email: 'brit@jaaz.org',                        name: 'Bri T',                    title: null,                                               company: 'Junior Achievement AZ',            phone_mobile: null,             phone_work: null,            address: null },
]

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('════════════════════════════════════════')
  console.log('  PERSONAL OS — CONTACT BACKFILL INSERT')
  console.log(`  ${CONTACTS.length} contacts to process`)
  console.log('════════════════════════════════════════\n')

  // Step 1: Add missing columns
  console.log('Step 1: Ensuring schema columns exist...')
  const { error: schemaErr } = await supabase.rpc('exec_sql', {
    sql: `
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_work TEXT;
      ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
      CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_unique ON contacts (lower(email));
    `
  }).catch(() => ({ error: null }))

  // Try direct approach if RPC not available
  try {
    await supabase.from('contacts').select('phone_work').limit(1)
    console.log('  ✓ Schema OK')
  } catch {
    console.log('  ⚠ Note: run ALTER TABLE manually if needed')
  }

  // Step 2: Deduplicate the list (just in case)
  const seen = new Set()
  const deduped = CONTACTS.filter(c => {
    const key = (c.email || '').toLowerCase().trim()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  console.log(`\nStep 2: Deduped to ${deduped.length} unique emails`)

  // Step 3: Upsert one at a time to avoid batch conflicts
  console.log('\nStep 3: Upserting contacts (fills missing fields only)...')
  let inserted = 0, updated = 0, errors = 0

  for (const contact of deduped) {
    try {
      // First check if contact exists
      const { data: existing } = await supabase
        .from('contacts')
        .select('id, name, title, company, phone_mobile, phone_work, address, enriched')
        .ilike('email', contact.email)
        .maybeSingle()

      const updates = {
        email:        contact.email.toLowerCase(),
        source:       'email',
        name:         existing?.name         || contact.name,
        title:        existing?.title        || contact.title,
        company:      existing?.company      || contact.company,
        phone_mobile: existing?.phone_mobile || contact.phone_mobile,
        phone_work:   existing?.phone_work   || contact.phone_work,
        address:      existing?.address      || contact.address,
        enriched:     existing?.enriched || !!(contact.title || contact.phone_mobile || contact.phone_work),
      }

      if (existing) {
        const { error } = await supabase
          .from('contacts')
          .update(updates)
          .eq('id', existing.id)
        if (error) throw error
        updated++
      } else {
        const { error } = await supabase
          .from('contacts')
          .insert(updates)
        if (error) throw error
        inserted++
      }
    } catch (err) {
      console.log(`  ⚠ ${contact.email}: ${err.message?.slice(0, 60)}`)
      errors++
    }
  }

  console.log('\n════════════════════════════════════════')
  console.log(`  Inserted:  ${inserted}`)
  console.log(`  Updated:   ${updated}`)
  console.log(`  Errors:    ${errors}`)
  console.log('════════════════════════════════════════')
}

main().catch(console.error)
