-- 初回起動時(空のボリューム)だけ実行される。テスト用 DB を作る(api/tests/setup.ts が使う)。
-- マイグレーションはテストの開始時に自動で適用される。
CREATE DATABASE ningyoutukai_test;
