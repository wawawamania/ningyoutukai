// Postgres の text は NUL 文字(\u0000)を保存できず、500 になるため、入力の時点で弾く
export const NO_NUL = "^[^\\u0000]*$";
