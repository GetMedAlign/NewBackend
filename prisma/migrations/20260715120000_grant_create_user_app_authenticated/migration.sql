-- Clinic Applications slice (approval provisioning): allow the RLS-subject role
-- to call create_user() inside the admin withUserContext transaction.
--
-- Approval provisions the clinic + its login user in ONE admin withUserContext
-- transaction. Inside that transaction the connection is switched to the
-- app_authenticated role (so RLS is enforced). create_user is SECURITY DEFINER
-- (runs as its owner, postgres) but the *caller* role still needs EXECUTE. The
-- rls_audit migration left create_user's ACL as {postgres=X} only, so
-- app_authenticated could not call it. Granting EXECUTE is safe: create_user
-- only inserts a users row + a default patient role, and runs as its definer.

GRANT EXECUTE ON FUNCTION create_user(citext, text) TO app_authenticated;
