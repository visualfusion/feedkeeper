-- Optional presentation plan for native editions; null for automatic and unstructured issues.
ALTER TABLE editions ADD COLUMN layout TEXT CHECK (layout IS NULL OR json_valid(layout));
