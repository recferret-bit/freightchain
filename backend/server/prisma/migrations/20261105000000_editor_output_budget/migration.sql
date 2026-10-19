-- GLM thinks on every editor turn. 32000 was the untouched default and cut a reply off mid-sentence.
UPDATE "player"."GameSetting" SET "value" = 100000 WHERE "key" = 'editor_max_output_tokens' AND "value" = 32000;
