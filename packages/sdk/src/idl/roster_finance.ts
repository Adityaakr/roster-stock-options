/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/roster_finance.json`.
 */
export type RosterFinance = {
  "address": "FJUdsdmxAp3zAwZBg3ai34xzeCBDobnH1XDarvVa7uFV",
  "metadata": {
    "name": "rosterFinance",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Roster Finance: fully collateralized, American-exercise, physically settled contracts on tokenized stocks, pooled per series"
  },
  "instructions": [
    {
      "name": "autoExercise",
      "docs": [
        "Keeper crank inside the window before expiry, with a Pyth update posted in the same transaction."
      ],
      "discriminator": [
        92,
        40,
        119,
        42,
        152,
        121,
        62,
        28
      ],
      "accounts": [
        {
          "name": "keeper",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.mint",
                "account": "marketConfig"
              }
            ]
          },
          "relations": [
            "series"
          ]
        },
        {
          "name": "series",
          "writable": true,
          "relations": [
            "autoExercise"
          ]
        },
        {
          "name": "holder",
          "relations": [
            "autoExercise"
          ]
        },
        {
          "name": "autoExercise",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  111,
                  101,
                  120
                ]
              },
              {
                "kind": "account",
                "path": "holder"
              },
              {
                "kind": "account",
                "path": "series"
              }
            ]
          }
        },
        {
          "name": "delegate",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  111,
                  101,
                  120,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "underlyingMint"
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "positionMint",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "holderPositionAta",
          "writable": true
        },
        {
          "name": "collateralVault",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "settlementVault",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "holderUnderlyingAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "holder"
              },
              {
                "kind": "account",
                "path": "underlyingTokenProgram"
              },
              {
                "kind": "account",
                "path": "underlyingMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "holderQuoteAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "holder"
              },
              {
                "kind": "account",
                "path": "quoteTokenProgram"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "feeVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "protocol"
              },
              {
                "kind": "account",
                "path": "quoteTokenProgram"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "keeperQuoteAta",
          "writable": true
        },
        {
          "name": "priceUpdate",
          "docs": [
            "The Pyth price update posted in this transaction; owner-checked by the receiver program id."
          ]
        },
        {
          "name": "underlyingTokenProgram"
        },
        {
          "name": "quoteTokenProgram"
        },
        {
          "name": "token2022Program",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        }
      ],
      "args": [
        {
          "name": "lots6",
          "type": "u64"
        }
      ]
    },
    {
      "name": "buy",
      "docs": [
        "Fill from the best asks at or below the limit; partial fills return the filled amount; zero fill fails."
      ],
      "discriminator": [
        102,
        6,
        61,
        18,
        1,
        218,
        235,
        234
      ],
      "accounts": [
        {
          "name": "buyer",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.mint",
                "account": "marketConfig"
              }
            ]
          },
          "relations": [
            "series"
          ]
        },
        {
          "name": "series",
          "writable": true
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "quoteVault",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "feeVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "protocol"
              },
              {
                "kind": "account",
                "path": "quoteTokenProgram"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "buyerQuoteAta",
          "writable": true
        },
        {
          "name": "positionMint",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "buyerPositionAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "buyer"
              },
              {
                "kind": "account",
                "path": "token2022Program"
              },
              {
                "kind": "account",
                "path": "positionMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "quoteTokenProgram"
        },
        {
          "name": "token2022Program",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "lots6",
          "type": "u64"
        },
        {
          "name": "maxPremiumPerLot",
          "type": "u64"
        },
        {
          "name": "referrer",
          "type": {
            "option": "pubkey"
          }
        }
      ]
    },
    {
      "name": "cancelAsk",
      "discriminator": [
        223,
        192,
        40,
        224,
        144,
        138,
        62,
        13
      ],
      "accounts": [
        {
          "name": "writer",
          "signer": true
        },
        {
          "name": "series",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "seq",
          "type": "u64"
        }
      ]
    },
    {
      "name": "claimPremium",
      "discriminator": [
        225,
        124,
        12,
        107,
        24,
        154,
        37,
        100
      ],
      "accounts": [
        {
          "name": "writer",
          "signer": true
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.mint",
                "account": "marketConfig"
              }
            ]
          },
          "relations": [
            "series"
          ]
        },
        {
          "name": "series",
          "writable": true
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "quoteVault",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "writerQuoteAta",
          "writable": true
        },
        {
          "name": "quoteTokenProgram"
        }
      ],
      "args": []
    },
    {
      "name": "closeSeries",
      "docs": [
        "After expiry plus grace and every writer settled: sweep dust, close vaults and the series, reclaim rent."
      ],
      "discriminator": [
        141,
        153,
        5,
        139,
        18,
        10,
        236,
        13
      ],
      "accounts": [
        {
          "name": "cranker",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.mint",
                "account": "marketConfig"
              }
            ]
          },
          "relations": [
            "series"
          ]
        },
        {
          "name": "series",
          "writable": true
        },
        {
          "name": "rentReceiver",
          "writable": true
        },
        {
          "name": "underlyingMint"
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "positionMint",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "collateralVault",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "settlementVault",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "quoteVault",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "feeVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "protocol"
              },
              {
                "kind": "account",
                "path": "quoteTokenProgram"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "treasury"
        },
        {
          "name": "treasuryUnderlyingAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "treasury"
              },
              {
                "kind": "account",
                "path": "underlyingTokenProgram"
              },
              {
                "kind": "account",
                "path": "underlyingMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "underlyingTokenProgram"
        },
        {
          "name": "quoteTokenProgram"
        },
        {
          "name": "token2022Program",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "createMarket",
      "docs": [
        "List an underlying from a registry entry. Token program, decimals and extension flags come from the mint."
      ],
      "discriminator": [
        103,
        226,
        97,
        235,
        200,
        188,
        251,
        254
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "createMarketParams"
            }
          }
        }
      ]
    },
    {
      "name": "createSeries",
      "docs": [
        "Create a series on the grid: pooled vaults and a Token-2022 position mint. Permissionless."
      ],
      "discriminator": [
        181,
        9,
        52,
        120,
        197,
        221,
        42,
        142
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.mint",
                "account": "marketConfig"
              }
            ]
          }
        },
        {
          "name": "underlyingMint"
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "collateralMint",
          "docs": [
            "Underlying for a call, USDC for a put; checked in the handler against `side`."
          ]
        },
        {
          "name": "settlementMint",
          "docs": [
            "The other leg."
          ]
        },
        {
          "name": "series",
          "writable": true
        },
        {
          "name": "positionMint",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "series"
              }
            ]
          }
        },
        {
          "name": "collateralVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "series"
              }
            ]
          }
        },
        {
          "name": "settlementVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "series"
              }
            ]
          }
        },
        {
          "name": "quoteVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  113,
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "series"
              }
            ]
          }
        },
        {
          "name": "collateralTokenProgram"
        },
        {
          "name": "settlementTokenProgram"
        },
        {
          "name": "quoteTokenProgram"
        },
        {
          "name": "token2022Program",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "side",
          "type": {
            "defined": {
              "name": "side"
            }
          }
        },
        {
          "name": "strikeUsdcPerLot",
          "type": "u64"
        },
        {
          "name": "expiryTs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "disableAutoExercise",
      "discriminator": [
        156,
        120,
        181,
        48,
        35,
        251,
        154,
        51
      ],
      "accounts": [
        {
          "name": "holder",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.mint",
                "account": "marketConfig"
              }
            ]
          },
          "relations": [
            "series"
          ]
        },
        {
          "name": "series"
        },
        {
          "name": "autoExercise",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  111,
                  101,
                  120
                ]
              },
              {
                "kind": "account",
                "path": "holder"
              },
              {
                "kind": "account",
                "path": "series"
              }
            ]
          }
        },
        {
          "name": "delegate",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  111,
                  101,
                  120,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "positionMint",
          "relations": [
            "series"
          ]
        },
        {
          "name": "holderPositionAta",
          "writable": true
        },
        {
          "name": "payMint",
          "docs": [
            "The account the exercise draws from: USDC for a call, the underlying for a put."
          ]
        },
        {
          "name": "holderPayAta",
          "writable": true
        },
        {
          "name": "payTokenProgram"
        },
        {
          "name": "token2022Program",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "enableAutoExercise",
      "docs": [
        "Opt in to auto-exercise: the program's delegate PDA is approved on the position and the paying account."
      ],
      "discriminator": [
        69,
        144,
        226,
        115,
        61,
        129,
        180,
        81
      ],
      "accounts": [
        {
          "name": "holder",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.mint",
                "account": "marketConfig"
              }
            ]
          },
          "relations": [
            "series"
          ]
        },
        {
          "name": "series"
        },
        {
          "name": "autoExercise",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  111,
                  101,
                  120
                ]
              },
              {
                "kind": "account",
                "path": "holder"
              },
              {
                "kind": "account",
                "path": "series"
              }
            ]
          }
        },
        {
          "name": "delegate",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  117,
                  116,
                  111,
                  101,
                  120,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "positionMint",
          "relations": [
            "series"
          ]
        },
        {
          "name": "holderPositionAta",
          "writable": true
        },
        {
          "name": "payMint",
          "docs": [
            "The account the exercise draws from: USDC for a call, the underlying for a put."
          ]
        },
        {
          "name": "holderPayAta",
          "writable": true
        },
        {
          "name": "payTokenProgram"
        },
        {
          "name": "token2022Program",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "minItmBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "exercise",
      "docs": [
        "Exercise any time before expiry. No oracle, never pausable."
      ],
      "discriminator": [
        144,
        79,
        103,
        64,
        241,
        78,
        80,
        174
      ],
      "accounts": [
        {
          "name": "holder",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.mint",
                "account": "marketConfig"
              }
            ]
          },
          "relations": [
            "series"
          ]
        },
        {
          "name": "series",
          "writable": true
        },
        {
          "name": "underlyingMint"
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "positionMint",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "holderPositionAta",
          "writable": true
        },
        {
          "name": "collateralVault",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "settlementVault",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "holderUnderlyingAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "holder"
              },
              {
                "kind": "account",
                "path": "underlyingTokenProgram"
              },
              {
                "kind": "account",
                "path": "underlyingMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "holderQuoteAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "holder"
              },
              {
                "kind": "account",
                "path": "quoteTokenProgram"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "underlyingTokenProgram"
        },
        {
          "name": "quoteTokenProgram"
        },
        {
          "name": "token2022Program",
          "address": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "lots6",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initProtocol",
      "docs": [
        "One-time protocol account: authorities, fee schedule, the canonical quote mint, the fee vault."
      ],
      "discriminator": [
        3,
        188,
        141,
        237,
        225,
        226,
        232,
        210
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "feeVault",
          "docs": [
            "The fee vault: the protocol PDA's associated token account for the quote mint."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "protocol"
              },
              {
                "kind": "account",
                "path": "quoteTokenProgram"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "quoteTokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "initProtocolParams"
            }
          }
        }
      ]
    },
    {
      "name": "observeHalt",
      "docs": [
        "Record an issuer pause or vault freeze on the series (permissionless; the keeper watches for it)."
      ],
      "discriminator": [
        111,
        8,
        76,
        50,
        198,
        28,
        149,
        4
      ],
      "accounts": [
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.mint",
                "account": "marketConfig"
              }
            ]
          },
          "relations": [
            "series"
          ]
        },
        {
          "name": "series",
          "writable": true
        },
        {
          "name": "underlyingMint"
        },
        {
          "name": "collateralVault",
          "relations": [
            "series"
          ]
        },
        {
          "name": "settlementVault",
          "relations": [
            "series"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "quote",
      "docs": [
        "Deposit collateral (optional) and post an ask from free collateral."
      ],
      "discriminator": [
        149,
        42,
        109,
        247,
        134,
        146,
        213,
        123
      ],
      "accounts": [
        {
          "name": "writer",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.mint",
                "account": "marketConfig"
              }
            ]
          },
          "relations": [
            "series"
          ]
        },
        {
          "name": "series",
          "writable": true
        },
        {
          "name": "collateralMint"
        },
        {
          "name": "collateralVault",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "writerCollateralAta",
          "writable": true
        },
        {
          "name": "collateralTokenProgram"
        }
      ],
      "args": [
        {
          "name": "depositLots6",
          "type": "u64"
        },
        {
          "name": "askLots6",
          "type": "u64"
        },
        {
          "name": "askPerLot",
          "type": "u64"
        }
      ]
    },
    {
      "name": "settleWriter",
      "docs": [
        "After expiry: pay a writer everything it is owed. Permissionless; destinations are derived."
      ],
      "discriminator": [
        254,
        7,
        49,
        225,
        73,
        124,
        46,
        178
      ],
      "accounts": [
        {
          "name": "cranker",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.mint",
                "account": "marketConfig"
              }
            ]
          },
          "relations": [
            "series"
          ]
        },
        {
          "name": "series",
          "writable": true
        },
        {
          "name": "writer"
        },
        {
          "name": "underlyingMint"
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "collateralVault",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "settlementVault",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "quoteVault",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "writerUnderlyingAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "writer"
              },
              {
                "kind": "account",
                "path": "underlyingTokenProgram"
              },
              {
                "kind": "account",
                "path": "underlyingMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "writerQuoteAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "writer"
              },
              {
                "kind": "account",
                "path": "quoteTokenProgram"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "underlyingTokenProgram"
        },
        {
          "name": "quoteTokenProgram"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "updateMarket",
      "docs": [
        "Roll the grid, change caps, list or pause. The pause key may only pause."
      ],
      "discriminator": [
        153,
        39,
        2,
        197,
        179,
        50,
        199,
        217
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.mint",
                "account": "marketConfig"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "updateMarketParams"
            }
          }
        }
      ]
    },
    {
      "name": "updateProtocol",
      "docs": [
        "Fee schedule, authorities, protocol-wide pause. The pause key may only pause."
      ],
      "discriminator": [
        206,
        25,
        218,
        114,
        109,
        41,
        74,
        173
      ],
      "accounts": [
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "protocol",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "updateProtocolParams"
            }
          }
        }
      ]
    },
    {
      "name": "withdrawFees",
      "docs": [
        "Move fees from the fee vault to the treasury's token account. Zero means everything."
      ],
      "discriminator": [
        198,
        212,
        171,
        109,
        144,
        215,
        174,
        89
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "feeVault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "protocol"
              },
              {
                "kind": "account",
                "path": "quoteTokenProgram"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "treasury"
        },
        {
          "name": "treasuryQuoteAta",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "treasury"
              },
              {
                "kind": "account",
                "path": "quoteTokenProgram"
              },
              {
                "kind": "account",
                "path": "quoteMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "quoteTokenProgram"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawUnsold",
      "docs": [
        "Withdraw never-sold collateral, any time."
      ],
      "discriminator": [
        6,
        159,
        31,
        233,
        165,
        117,
        226,
        159
      ],
      "accounts": [
        {
          "name": "writer",
          "writable": true,
          "signer": true
        },
        {
          "name": "protocol",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  111,
                  116,
                  111,
                  99,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.mint",
                "account": "marketConfig"
              }
            ]
          },
          "relations": [
            "series"
          ]
        },
        {
          "name": "series",
          "writable": true
        },
        {
          "name": "collateralMint"
        },
        {
          "name": "collateralVault",
          "writable": true,
          "relations": [
            "series"
          ]
        },
        {
          "name": "writerCollateralAta",
          "writable": true
        },
        {
          "name": "collateralTokenProgram"
        }
      ],
      "args": [
        {
          "name": "lots6",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "autoExercise",
      "discriminator": [
        219,
        39,
        248,
        207,
        134,
        14,
        83,
        241
      ]
    },
    {
      "name": "marketConfig",
      "discriminator": [
        119,
        255,
        200,
        88,
        252,
        82,
        128,
        24
      ]
    },
    {
      "name": "protocol",
      "discriminator": [
        45,
        39,
        101,
        43,
        115,
        72,
        131,
        40
      ]
    },
    {
      "name": "series",
      "discriminator": [
        240,
        97,
        8,
        183,
        139,
        77,
        250,
        162
      ]
    }
  ],
  "events": [
    {
      "name": "askCancelled",
      "discriminator": [
        115,
        173,
        229,
        248,
        105,
        252,
        126,
        155
      ]
    },
    {
      "name": "askPosted",
      "discriminator": [
        41,
        181,
        65,
        73,
        229,
        245,
        240,
        2
      ]
    },
    {
      "name": "bought",
      "discriminator": [
        193,
        56,
        215,
        24,
        156,
        76,
        42,
        104
      ]
    },
    {
      "name": "collateralWithdrawn",
      "discriminator": [
        51,
        224,
        133,
        106,
        74,
        173,
        72,
        82
      ]
    },
    {
      "name": "exercised",
      "discriminator": [
        199,
        234,
        66,
        198,
        152,
        62,
        234,
        154
      ]
    },
    {
      "name": "feesWithdrawn",
      "discriminator": [
        234,
        15,
        0,
        119,
        148,
        241,
        40,
        21
      ]
    },
    {
      "name": "fill",
      "discriminator": [
        78,
        225,
        199,
        154,
        86,
        219,
        224,
        169
      ]
    },
    {
      "name": "marketCreated",
      "discriminator": [
        88,
        184,
        130,
        231,
        226,
        84,
        6,
        58
      ]
    },
    {
      "name": "marketUpdated",
      "discriminator": [
        170,
        51,
        74,
        147,
        116,
        168,
        217,
        251
      ]
    },
    {
      "name": "pauseToggled",
      "discriminator": [
        105,
        215,
        89,
        53,
        198,
        232,
        136,
        161
      ]
    },
    {
      "name": "premiumClaimed",
      "discriminator": [
        60,
        221,
        78,
        168,
        150,
        45,
        78,
        169
      ]
    },
    {
      "name": "seriesClosed",
      "discriminator": [
        97,
        146,
        166,
        119,
        177,
        104,
        132,
        53
      ]
    },
    {
      "name": "seriesCreated",
      "discriminator": [
        2,
        164,
        54,
        38,
        24,
        181,
        233,
        180
      ]
    },
    {
      "name": "writerSettled",
      "discriminator": [
        221,
        5,
        98,
        158,
        18,
        100,
        21,
        226
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "feeOutOfRange",
      "msg": "fee bps out of range"
    },
    {
      "code": 6001,
      "name": "overflow",
      "msg": "arithmetic overflow"
    },
    {
      "code": 6002,
      "name": "unauthorized",
      "msg": "unauthorized"
    },
    {
      "code": 6003,
      "name": "wrongQuoteMint",
      "msg": "quote mint must be the protocol quote mint"
    },
    {
      "code": 6004,
      "name": "tooFewDecimals",
      "msg": "mint has fewer than six decimals"
    },
    {
      "code": 6005,
      "name": "notListed",
      "msg": "market is not listed"
    },
    {
      "code": 6006,
      "name": "paused",
      "msg": "market or protocol is paused"
    },
    {
      "code": 6007,
      "name": "expiryOffGrid",
      "msg": "expiry is not on the market grid"
    },
    {
      "code": 6008,
      "name": "strikeOffGrid",
      "msg": "strike is not on the market grid"
    },
    {
      "code": 6009,
      "name": "seriesCapReached",
      "msg": "live series cap reached for this market"
    },
    {
      "code": 6010,
      "name": "wrongVaultMint",
      "msg": "side and vault mints do not agree"
    },
    {
      "code": 6011,
      "name": "expired",
      "msg": "series has expired"
    },
    {
      "code": 6012,
      "name": "notExpired",
      "msg": "series has not expired"
    },
    {
      "code": 6013,
      "name": "halted",
      "msg": "series is halted by an issuer pause or freeze"
    },
    {
      "code": 6014,
      "name": "sizeOutOfRange",
      "msg": "size is outside the market limits"
    },
    {
      "code": 6015,
      "name": "noWriterSlot",
      "msg": "writer has no slot in this series"
    },
    {
      "code": 6016,
      "name": "writerSlotsFull",
      "msg": "no free writer slot in this series"
    },
    {
      "code": 6017,
      "name": "writerCapReached",
      "msg": "writer cap reached"
    },
    {
      "code": 6018,
      "name": "insufficientFreeCollateral",
      "msg": "not enough free collateral"
    },
    {
      "code": 6019,
      "name": "askRejected",
      "msg": "ask is worse than every resident ask and the list is full"
    },
    {
      "code": 6020,
      "name": "askNotFound",
      "msg": "ask not found"
    },
    {
      "code": 6021,
      "name": "quoteMoved",
      "msg": "nothing could be filled at or below the limit"
    },
    {
      "code": 6022,
      "name": "integratorNotRegistered",
      "msg": "referrer is not a registered integrator"
    },
    {
      "code": 6023,
      "name": "insufficientPosition",
      "msg": "holder does not hold enough position tokens"
    },
    {
      "code": 6024,
      "name": "alreadySettled",
      "msg": "writer already settled"
    },
    {
      "code": 6025,
      "name": "vaultsNotEmpty",
      "msg": "vaults are not empty"
    },
    {
      "code": 6026,
      "name": "writersUnsettled",
      "msg": "not every writer has settled"
    },
    {
      "code": 6027,
      "name": "graceNotElapsed",
      "msg": "grace period has not elapsed"
    },
    {
      "code": 6028,
      "name": "wrongRentReceiver",
      "msg": "rent receiver must be the rent payer"
    },
    {
      "code": 6029,
      "name": "wrongAccount",
      "msg": "account does not match the series"
    },
    {
      "code": 6030,
      "name": "wrongTokenProgram",
      "msg": "wrong token program for this mint"
    },
    {
      "code": 6031,
      "name": "badPriceUpdate",
      "msg": "price update is stale, unverified, or for the wrong feed"
    },
    {
      "code": 6032,
      "name": "notInTheMoney",
      "msg": "position is not in the money by more than the keeper fee"
    },
    {
      "code": 6033,
      "name": "autoExerciseDisabled",
      "msg": "auto-exercise is not enabled for this holder"
    },
    {
      "code": 6034,
      "name": "outsideWindow",
      "msg": "outside the auto-exercise window"
    }
  ],
  "types": [
    {
      "name": "ask",
      "docs": [
        "A resident ask: `writer_slot` indexes `Series::writers`. Plain-old-data, 32 bytes."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "remainingLots6",
            "type": "u64"
          },
          {
            "name": "askPerLot",
            "type": "u64"
          },
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "writerSlot",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                7
              ]
            }
          }
        ]
      }
    },
    {
      "name": "askCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "series",
            "type": "pubkey"
          },
          {
            "name": "writer",
            "type": "pubkey"
          },
          {
            "name": "seq",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "askPosted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "series",
            "type": "pubkey"
          },
          {
            "name": "writer",
            "type": "pubkey"
          },
          {
            "name": "lots6",
            "type": "u64"
          },
          {
            "name": "askPerLot",
            "type": "u64"
          },
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "evictedSeq",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "autoExercise",
      "docs": [
        "Per-holder opt-in for the keeper's auto-exercise crank; the delegate is a program PDA, never the keeper key."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "series",
            "type": "pubkey"
          },
          {
            "name": "enabled",
            "type": "bool"
          },
          {
            "name": "minItmBps",
            "type": "u16"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                16
              ]
            }
          }
        ]
      }
    },
    {
      "name": "bought",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "series",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "lots6Filled",
            "type": "u64"
          },
          {
            "name": "lots6Requested",
            "type": "u64"
          },
          {
            "name": "premiumPaid",
            "type": "u64"
          },
          {
            "name": "fee",
            "type": "u64"
          },
          {
            "name": "asksWalked",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "collateralWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "series",
            "type": "pubkey"
          },
          {
            "name": "writer",
            "type": "pubkey"
          },
          {
            "name": "lots6",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "createMarketParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tokenFeedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "equityFeedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "allowedExpiries",
            "type": {
              "array": [
                "i64",
                4
              ]
            }
          },
          {
            "name": "strikeStep",
            "type": "u64"
          },
          {
            "name": "minStrike",
            "type": "u64"
          },
          {
            "name": "maxStrike",
            "type": "u64"
          },
          {
            "name": "maxLiveSeries",
            "type": "u16"
          },
          {
            "name": "minLots6",
            "type": "u64"
          },
          {
            "name": "maxLots6",
            "type": "u64"
          },
          {
            "name": "maxWriterLots6",
            "type": "u64"
          },
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "maxPriceAgeSecs",
            "type": "u32"
          },
          {
            "name": "maxConfBps",
            "type": "u16"
          },
          {
            "name": "symbol",
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "feedPricesUiShare",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "exercised",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "series",
            "type": "pubkey"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "lots6",
            "type": "u64"
          },
          {
            "name": "usdc",
            "type": "u64"
          },
          {
            "name": "raw",
            "type": "u64"
          },
          {
            "name": "auto",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "feesWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "to",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "fill",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "series",
            "type": "pubkey"
          },
          {
            "name": "buyer",
            "type": "pubkey"
          },
          {
            "name": "writer",
            "type": "pubkey"
          },
          {
            "name": "lots6",
            "type": "u64"
          },
          {
            "name": "askPerLot",
            "type": "u64"
          },
          {
            "name": "premium",
            "type": "u64"
          },
          {
            "name": "seq",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "initProtocolParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pauseAuthority",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "integratorShareBps",
            "type": "u16"
          },
          {
            "name": "keeperFeeUsdc",
            "type": "u64"
          },
          {
            "name": "graceSecs",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "marketConfig",
      "docs": [
        "One listed underlying. Created from a registry entry; token program, decimals and extension flags are derived from",
        "the mint account on-chain, never taken from the entry."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "type": "pubkey"
          },
          {
            "name": "tokenProgram",
            "type": "pubkey"
          },
          {
            "name": "decimals",
            "type": "u8"
          },
          {
            "name": "hasTransferFee",
            "type": "bool"
          },
          {
            "name": "hasPermanentDelegate",
            "type": "bool"
          },
          {
            "name": "pausable",
            "type": "bool"
          },
          {
            "name": "hookProgram",
            "docs": [
              "Pubkey::default when the hook slot is empty; a non-default value means every vault transfer needs extra accounts."
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenFeedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "equityFeedId",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "allowedExpiries",
            "docs": [
              "Expiries the keeper keeps rolled (16:00 New York); zero means unused."
            ],
            "type": {
              "array": [
                "i64",
                4
              ]
            }
          },
          {
            "name": "strikeStep",
            "docs": [
              "Strikes are micro-USDC per lot and must be multiples of this inside [min_strike, max_strike]."
            ],
            "type": "u64"
          },
          {
            "name": "minStrike",
            "type": "u64"
          },
          {
            "name": "maxStrike",
            "type": "u64"
          },
          {
            "name": "maxLiveSeries",
            "type": "u16"
          },
          {
            "name": "liveSeries",
            "type": "u16"
          },
          {
            "name": "minLots6",
            "type": "u64"
          },
          {
            "name": "maxLots6",
            "type": "u64"
          },
          {
            "name": "maxWriterLots6",
            "type": "u64"
          },
          {
            "name": "tier",
            "type": "u8"
          },
          {
            "name": "listed",
            "type": "bool"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "issuerPausedAt",
            "type": "i64"
          },
          {
            "name": "maxPriceAgeSecs",
            "type": "u32"
          },
          {
            "name": "maxConfBps",
            "type": "u16"
          },
          {
            "name": "symbol",
            "docs": [
              "Ticker used in position-token metadata, set at listing; never caller-supplied."
            ],
            "type": {
              "array": [
                "u8",
                8
              ]
            }
          },
          {
            "name": "feedPricesUiShare",
            "docs": [
              "The token feed prices one UI share-equivalent (true) or one raw token (false); decides the multiplier factor in auto-exercise."
            ],
            "type": "bool"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                55
              ]
            }
          }
        ]
      }
    },
    {
      "name": "marketCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "tier",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "marketUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "listed",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "pauseToggled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "premiumClaimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "series",
            "type": "pubkey"
          },
          {
            "name": "writer",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "priceFeedMessage",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "feedId",
            "docs": [
              "`FeedId` but avoid the type alias because of compatibility issues with Anchor's `idl-build` feature."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "price",
            "type": "i64"
          },
          {
            "name": "conf",
            "type": "u64"
          },
          {
            "name": "exponent",
            "type": "i32"
          },
          {
            "name": "publishTime",
            "docs": [
              "The timestamp of this price update in seconds"
            ],
            "type": "i64"
          },
          {
            "name": "prevPublishTime",
            "docs": [
              "The timestamp of the previous price update. This field is intended to allow users to",
              "identify the single unique price update for any moment in time:",
              "for any time t, the unique update is the one such that prev_publish_time < t <= publish_time.",
              "",
              "Note that there may not be such an update while we are migrating to the new message-sending logic,",
              "as some price updates on pythnet may not be sent to other chains (because the message-sending",
              "logic may not have triggered). We can solve this problem by making the message-sending mandatory",
              "(which we can do once publishers have migrated over).",
              "",
              "Additionally, this field may be equal to publish_time if the message is sent on a slot where",
              "where the aggregation was unsuccesful. This problem will go away once all publishers have",
              "migrated over to a recent version of pyth-agent."
            ],
            "type": "i64"
          },
          {
            "name": "emaPrice",
            "type": "i64"
          },
          {
            "name": "emaConf",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "priceUpdateV2",
      "docs": [
        "A price update account. This account is used by the Pyth Receiver program to store a verified price update from a Pyth price feed.",
        "It contains:",
        "- `write_authority`: The write authority for this account. This authority can close this account to reclaim rent or update the account to contain a different price update.",
        "- `verification_level`: The [`VerificationLevel`] of this price update. This represents how many Wormhole guardian signatures have been verified for this price update.",
        "- `price_message`: The actual price update.",
        "- `posted_slot`: The slot at which this price update was posted."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "writeAuthority",
            "type": "pubkey"
          },
          {
            "name": "verificationLevel",
            "type": {
              "defined": {
                "name": "verificationLevel"
              }
            }
          },
          {
            "name": "priceMessage",
            "type": {
              "defined": {
                "name": "priceFeedMessage"
              }
            }
          },
          {
            "name": "postedSlot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "protocol",
      "docs": [
        "Protocol-wide configuration. `authority` is the Squads vault; `pause_authority` can pause and nothing else."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "pauseAuthority",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "type": "pubkey"
          },
          {
            "name": "feeBps",
            "type": "u16"
          },
          {
            "name": "integratorShareBps",
            "type": "u16"
          },
          {
            "name": "keeperFeeUsdc",
            "type": "u64"
          },
          {
            "name": "graceSecs",
            "type": "i64"
          },
          {
            "name": "pausedAll",
            "type": "bool"
          },
          {
            "name": "seriesCreator",
            "docs": [
              "Who may create series on Tier 1 and Tier 2 markets (the quoter); the authority always may. Tier 3 is open.",
              "Zero means \"authority only\", so a protocol account written before this field behaves as before."
            ],
            "type": "pubkey"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "series",
      "docs": [
        "One term: pooled collateral, pooled settlement, a bounded ask list and every writer's slot. Zero-copy: the",
        "account is about 4.9 KB and is read in place, never deserialized onto the stack."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "collateralVault",
            "type": "pubkey"
          },
          {
            "name": "settlementVault",
            "type": "pubkey"
          },
          {
            "name": "quoteVault",
            "type": "pubkey"
          },
          {
            "name": "positionMint",
            "type": "pubkey"
          },
          {
            "name": "rentPayer",
            "type": "pubkey"
          },
          {
            "name": "strikeUsdcPerLot",
            "docs": [
              "Micro-USDC exchanged per lot at exercise. Stored as given; the program never derives it from a multiplier."
            ],
            "type": "u64"
          },
          {
            "name": "expiryTs",
            "type": "i64"
          },
          {
            "name": "totalSoldLots6",
            "type": "u64"
          },
          {
            "name": "totalExercisedLots6",
            "type": "u64"
          },
          {
            "name": "unassignedLots6",
            "type": "u64"
          },
          {
            "name": "p",
            "type": {
              "array": [
                "u64",
                2
              ]
            }
          },
          {
            "name": "haltedAt",
            "type": "i64"
          },
          {
            "name": "resumedAt",
            "docs": [
              "First observation of the mint unpaused after a halt; settlement waits 24 h from here."
            ],
            "type": "i64"
          },
          {
            "name": "seq",
            "type": "u64"
          },
          {
            "name": "epoch",
            "type": "u32"
          },
          {
            "name": "scale",
            "type": "u8"
          },
          {
            "name": "state",
            "type": "u8"
          },
          {
            "name": "side",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "asksLen",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                7
              ]
            }
          },
          {
            "name": "asks",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "ask"
                  }
                },
                32
              ]
            }
          },
          {
            "name": "writers",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "writerSlot"
                  }
                },
                32
              ]
            }
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                64
              ]
            }
          }
        ]
      }
    },
    {
      "name": "seriesClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "series",
            "type": "pubkey"
          },
          {
            "name": "dustCollateral",
            "type": "u64"
          },
          {
            "name": "dustSettlement",
            "type": "u64"
          },
          {
            "name": "mintClosed",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "seriesCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "series",
            "type": "pubkey"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "side",
            "type": {
              "defined": {
                "name": "side"
              }
            }
          },
          {
            "name": "strikeUsdcPerLot",
            "type": "u64"
          },
          {
            "name": "expiryTs",
            "type": "i64"
          },
          {
            "name": "positionMint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "side",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "call"
          },
          {
            "name": "put"
          }
        ]
      }
    },
    {
      "name": "updateMarketParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "allowedExpiries",
            "type": {
              "option": {
                "array": [
                  "i64",
                  4
                ]
              }
            }
          },
          {
            "name": "strikeStep",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "minStrike",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "maxStrike",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "maxLiveSeries",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "minLots6",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "maxLots6",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "maxWriterLots6",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "tier",
            "type": {
              "option": "u8"
            }
          },
          {
            "name": "listed",
            "type": {
              "option": "bool"
            }
          },
          {
            "name": "paused",
            "type": {
              "option": "bool"
            }
          },
          {
            "name": "maxPriceAgeSecs",
            "type": {
              "option": "u32"
            }
          },
          {
            "name": "maxConfBps",
            "type": {
              "option": "u16"
            }
          }
        ]
      }
    },
    {
      "name": "updateProtocolParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "pauseAuthority",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "treasury",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "feeBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "integratorShareBps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "keeperFeeUsdc",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "graceSecs",
            "type": {
              "option": "i64"
            }
          },
          {
            "name": "pausedAll",
            "type": {
              "option": "bool"
            }
          },
          {
            "name": "seriesCreator",
            "type": {
              "option": "pubkey"
            }
          }
        ]
      }
    },
    {
      "name": "verificationLevel",
      "docs": [
        "Pyth price updates are bridged to all blockchains via Wormhole.",
        "Using the price updates on another chain requires verifying the signatures of the Wormhole guardians.",
        "The usual process is to check the signatures for two thirds of the total number of guardians, but this can be cumbersome on Solana because of the transaction size limits,",
        "so we also allow for partial verification.",
        "",
        "This enum represents how much a price update has been verified:",
        "- If `Full`, we have verified the signatures for two thirds of the current guardians.",
        "- If `Partial`, only `num_signatures` guardian signatures have been checked.",
        "",
        "# Warning",
        "Using partially verified price updates is dangerous, as it lowers the threshold of guardians that need to collude to produce a malicious price update."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "partial",
            "fields": [
              {
                "name": "numSignatures",
                "type": "u8"
              }
            ]
          },
          {
            "name": "full"
          }
        ]
      }
    },
    {
      "name": "writerSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "series",
            "type": "pubkey"
          },
          {
            "name": "writer",
            "type": "pubkey"
          },
          {
            "name": "freeLots6",
            "type": "u64"
          },
          {
            "name": "unassignedLots6",
            "type": "u64"
          },
          {
            "name": "assignedLots6",
            "type": "u64"
          },
          {
            "name": "collateralOut",
            "type": "u64"
          },
          {
            "name": "settlementOut",
            "type": "u64"
          },
          {
            "name": "premiumOut",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "writerSlot",
      "docs": [
        "A writer's accounting inside the series. Lots are six-decimal. `open` is the writer's unassigned sold lots at the",
        "last fold; the fold brings it to the present through `P`, `scale` and `epoch` (see `math`). 112 bytes."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "writer",
            "type": "pubkey"
          },
          {
            "name": "pSnap",
            "type": {
              "array": [
                "u64",
                2
              ]
            }
          },
          {
            "name": "depositedLots6",
            "type": "u64"
          },
          {
            "name": "withdrawnLots6",
            "type": "u64"
          },
          {
            "name": "soldLots6",
            "type": "u64"
          },
          {
            "name": "openLots6",
            "type": "u64"
          },
          {
            "name": "assignedLots6",
            "type": "u64"
          },
          {
            "name": "premiumClaimable",
            "type": "u64"
          },
          {
            "name": "epochSnap",
            "type": "u32"
          },
          {
            "name": "scaleSnap",
            "type": "u8"
          },
          {
            "name": "settled",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                10
              ]
            }
          }
        ]
      }
    }
  ]
};
