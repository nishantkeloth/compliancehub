-- Removes every test visa created by seed_test_visas.sql (all rows marked
-- "TEST DATA - visa seed" in the Notes field). Their change-log entries and
-- file versions go with them. The visa types and the Visa document type
-- stay, and any visa you entered yourself is not touched.
begin;
delete from crew_documents where notes like 'TEST DATA - visa seed%';
commit;
select count(*) as test_visas_left from crew_documents where notes like 'TEST DATA - visa seed%';
