package com.laboratory.managementsystem;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class PairingLinkParserTest {
    private static final String TOKEN = "abcdefghijklmnopqrstuvwxyz_ABCD-0123456789";
    private static final String QUERY = "v=2&server=https%3A%2F%2Flab.example.com&token=" + TOKEN;

    @Test
    public void parse_acceptsStrictV2CustomAndHttpsLinks() {
        for (String link : new String[] {
            "labapp://pair?" + QUERY,
            "labapp://pair/?" + QUERY,
            "https://lab.example.com/api/v5/app-pairing/link?" + QUERY
        }) {
            PairingLinkParser.ParsedPairing pairing = PairingLinkParser.parse(link);
            assertNotNull(link, pairing);
            assertEquals("2", pairing.getVersion());
            assertEquals("https://lab.example.com", pairing.getServerUrl());
            assertEquals(TOKEN, pairing.getToken());
        }
    }

    @Test
    public void parse_rejectsLegacyAmbiguousAndCrossOriginLinks() {
        String[] invalidLinks = {
            null,
            "",
            " labapp://pair?" + QUERY,
            "labapp://pair?" + QUERY + " ",
            "labapp://pair?v=1&server=https%3A%2F%2Flab.example.com&token=" + TOKEN,
            "labapp://pair?v=2&server=http%3A%2F%2Flab.example.com&token=" + TOKEN,
            "labapp://pair?" + QUERY + "&extra=1",
            "labapp://pair?" + QUERY + "&token=" + TOKEN,
            "labapp://pair/path?" + QUERY,
            "labapp://pair:443?" + QUERY,
            "labapp://user@pair?" + QUERY,
            "labapp://pair?" + QUERY + "#fragment",
            "labapp://pair?v=2&server=https%ZZ%2F%2Flab.example.com&token=" + TOKEN,
            "labapp://pair?v=2&server=https%3A%2F%2Flab.example.com&token=contains+space",
            "https://other.example.com/api/v5/app-pairing/link?" + QUERY,
            "https://lab.example.com/other?" + QUERY,
            "https://user@lab.example.com/api/v5/app-pairing/link?" + QUERY,
            "http://lab.example.com/api/v5/app-pairing/link?" + QUERY
        };

        for (String link : invalidLinks) {
            assertNull(String.valueOf(link), PairingLinkParser.parse(link));
        }
    }
}
