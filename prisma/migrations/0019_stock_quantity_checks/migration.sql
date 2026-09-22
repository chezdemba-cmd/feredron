-- Garde-fous DB en complément de la logique applicative (movement-rules.ts) :
-- `quantity` est TOUJOURS strictement positive sur les mouvements/réservations
-- de stock (le signe physique vient du `type`, jamais de `quantity`). Un
-- correctif manuel, un import ou un futur endpoint qui contournerait la
-- couche applicative ne pourra plus insérer une valeur incohérente.
--
-- `NOT VALID` puis `VALIDATE CONSTRAINT` : évite un verrou ACCESS EXCLUSIVE
-- prolongé sur de grandes tables en production (pattern recommandé Postgres
-- pour ajouter une contrainte sans bloquer les écritures concurrentes).

ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_quantity_positive" CHECK ("quantity" > 0) NOT VALID;
ALTER TABLE "stock_movements"
  VALIDATE CONSTRAINT "stock_movements_quantity_positive";

ALTER TABLE "stock_reservations"
  ADD CONSTRAINT "stock_reservations_quantity_positive" CHECK ("quantity" > 0) NOT VALID;
ALTER TABLE "stock_reservations"
  VALIDATE CONSTRAINT "stock_reservations_quantity_positive";
