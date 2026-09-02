-- Descriptions for the 11 genres created 2026-09-02 with description = null.
--
-- Not cosmetic. oracleBatch renders the catalogue into the prompt as
-- "- Name: description", falling back to "- Name" when there is none. A genre
-- with no description reaches the Oracle as a bare word it cannot match against,
-- so the Oracle invents a near-duplicate instead of reusing it — and the
-- duplicate is also created without a description, which makes the problem
-- self-reinforcing. Every undescribed genre is a seed for its own copy.
--
-- Boundaries drawn deliberately against the neighbours each of these could be
-- confused with: Latin American Literature against International Fiction and
-- Chicano & Latinx Fiction; Contemporary Fantasy against Urban Fantasy; Hard
-- Science Fiction against Science Fiction; Feminist Theory against Feminist
-- Fiction.

update genres set description = 'Meaning by suggestion, never by statement. Late nineteenth-century writing that trusts image and music over plot — Mallarmé, Huysmans, and the decadence that followed them.' where normalized_name = 'symbolist';

update genres set description = 'The engineering is wet, and it is you. Near-futures of gene editing, grown organisms and biotech escaping the lab — cyberpunk''s concerns relocated from the circuit to the cell.' where normalized_name = 'biopunk';

update genres set description = 'The physics has to hold. Science fiction that accepts the constraints of real science and finds the story inside them — orbital mechanics, light-speed lag, and problems solved with arithmetic.' where normalized_name = 'hardsciencefiction';

update genres set description = 'The argument, not the story. Scholarship and essays on gender, power and labour — the thinking that feminist fiction is usually written alongside.' where normalized_name = 'feministtheory';

update genres set description = 'Magic in the present day, and not only in the city. Fantasy set in our own era and our own world — the broad shelf for present-day magic that is not specifically urban.' where normalized_name = 'contemporaryfantasy';

update genres set description = 'How organisations actually work, and how they fail. Strategy, markets and management — written for the person doing the job rather than the shareholder.' where normalized_name = 'business';

update genres set description = 'Responsibility for other people''s work. Books on leading, deciding and being followed — the part of management that is a temperament rather than a technique.' where normalized_name = 'leadership';

update genres set description = 'Legions, senates, and gods with civic duties. Invented worlds built on Rome — imperial expansion, patronage, and the machinery of a republic going wrong.' where normalized_name = 'romaninspiredfantasy';

update genres set description = 'A continent that writes as though realism were optional. Fiction from Latin America — the Boom and everything since, where political violence and the miraculous share a page.' where normalized_name = 'latinamericanliterature';

update genres set description = 'How power ought to be arranged, argued from first principles. Sovereignty, justice, rights and legitimacy — the texts the argument keeps returning to.' where normalized_name = 'politicaltheory';

update genres set description = 'Bargaining with what is already dead. Magic worked through corpses, bindings and the raised — where the cost is usually paid by someone no longer able to object.' where normalized_name = 'necromancy';

-- Must return 0 rows before running curation.
-- select name from genres where description is null or btrim(description) = '';
