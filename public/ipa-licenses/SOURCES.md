# British English IPA data

Bundled dataset: open-dict-data/ipa-dict, data/en_UK.txt (Received Pronunciation).
Source: https://github.com/open-dict-data/ipa-dict/blob/master/data/en_UK.txt
Upstream: https://github.com/melissaboiko/ipacards

The UK dataset is derived from ipacards and retains its GPL-3.0 license.
The ipa-dict repository otherwise uses MIT; see its README credits for the dataset exception.
Both license texts and the unmodified tab-separated dataset are included here.

ipa-en-gb.json transforms the source into lower-case lookup keys and arrays of IPA forms.
COMMON_UK in ipa.mjs supplies independently written common-word, contraction and heteronym readings.
Those supplements are separate from the source wordlist; they include weak/strong readings where applicable.

The original source SHA256 is 221394caef0cf723b4f2df81a98ac33191293257b88aed5b1fb89466d3a0dc77.
The source contains 65,119 entries. No audio or definitions are redistributed.
