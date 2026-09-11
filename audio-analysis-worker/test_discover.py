import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import discover
from discover import (
    DiscoveryError, collect, fetch_apple_chart, fetch_soundcloud_chart, find_youtube_id,
)


def runner_for(payload):
    return lambda *a, **k: SimpleNamespace(stdout=json.dumps(payload).encode())


def runner_sequence(payloads):
    """호출마다 다른 응답을 준다. 차트 조회 뒤 곡별 조회가 이어지는 흐름에 필요하다."""
    remaining = list(payloads)

    def run(*a, **k):
        payload = remaining.pop(0) if remaining else {}
        if isinstance(payload, Exception):
            raise payload
        return SimpleNamespace(stdout=json.dumps(payload).encode())
    return run


def opener_for(payload):
    class Response:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return json.dumps(payload).encode()
    return lambda *a, **k: Response()


APPLE = {'feed': {'results': [
    {'artistName': 'BIG Naughty', 'name': '노스탈지아', 'releaseDate': '2026-08-31'},
    {'artistName': '튜이드', 'name': 'SUN KISS', 'releaseDate': '2026-08-24'},
]}}


class AppleChartTest(unittest.TestCase):
    def test_reads_artist_title_and_release_date(self):
        rows = fetch_apple_chart(10, opener=opener_for(APPLE))

        self.assertEqual(rows[0], {'artist': 'BIG Naughty', 'title': '노스탈지아',
                                   'released_at': '2026-08-31'})

    def test_fetch_failure_is_reported_with_a_fixed_code(self):
        def broken(*_a, **_k):
            raise OSError('network down')
        with self.assertRaisesRegex(DiscoveryError, '^SOURCE_FETCH_FAILED$'):
            fetch_apple_chart(10, opener=broken)


class YouTubeMatchTest(unittest.TestCase):
    def test_returns_the_first_usable_video_id(self):
        payload = {'entries': [{'id': 'abcdefghijk', 'duration': 195}]}

        self.assertEqual(find_youtube_id('BIG Naughty', '노스탈지아', runner_for(payload)), 'abcdefghijk')

    def test_skips_results_outside_the_duration_contract(self):
        # 앨범 전체나 플레이리스트가 검색 상위에 오는 경우가 있다.
        payload = {'entries': [{'id': 'aaaaaaaaaaa', 'duration': 8907},
                               {'id': 'bbbbbbbbbbb', 'duration': 200}]}

        self.assertEqual(find_youtube_id('a', 'b', runner_for(payload)), 'bbbbbbbbbbb')

    def test_keeps_results_without_duration(self):
        # 검색 결과가 길이를 주지 않는 경우가 있다. 여기서 막지 않고 다운로드 단계가 본다.
        payload = {'entries': [{'id': 'abcdefghijk', 'duration': None}]}

        self.assertEqual(find_youtube_id('a', 'b', runner_for(payload)), 'abcdefghijk')

    def test_no_match_returns_none(self):
        self.assertIsNone(find_youtube_id('a', 'b', runner_for({'entries': []})))


class SoundcloudChartTest(unittest.TestCase):
    CHART = {'entries': [
        {'url': 'https://soundcloud.com/a/mix'},
        {'url': 'https://soundcloud.com/b/hit'},
        {'url': 'https://soundcloud.com/c/quiet'},
    ]}

    def test_keeps_chart_order_and_drops_long_mixes(self):
        """순서가 곧 순위다. 재생 수로 다시 정렬하면 차트 순위를 버리는 것이다."""
        tracks, scanned = fetch_soundcloud_chart(3, runner=runner_sequence([
            self.CHART,
            {'title': '긴 믹스', 'duration': 3510, 'uploader': 'A',
             'webpage_url': 'https://soundcloud.com/a/mix'},
            {'title': '히트곡', 'duration': 210, 'uploader': 'B',
             'webpage_url': 'https://soundcloud.com/b/hit'},
            {'title': '조용한 곡', 'duration': 200, 'uploader': 'C',
             'webpage_url': 'https://soundcloud.com/c/quiet'},
        ]))

        self.assertEqual([track['title'] for track in tracks], ['히트곡', '조용한 곡'])
        self.assertEqual(tracks[0]['platform'], 'soundcloud')
        self.assertEqual(tracks[0]['track_key'], 'https://soundcloud.com/b/hit')
        # 걸러낸 곡도 훑은 개수에는 들어가야 다음 요청이 같은 구간을 다시 보지 않는다.
        self.assertEqual(scanned, 3)

    def test_offset_and_limit_cut_before_per_track_lookups(self):
        calls = []

        def run(*a, **k):
            calls.append(a[0])
            payload = self.CHART if len(calls) == 1 else {
                'title': '곡', 'duration': 200, 'uploader': 'X',
                'webpage_url': 'https://soundcloud.com/b/hit'}
            return SimpleNamespace(stdout=json.dumps(payload).encode())

        tracks, scanned = fetch_soundcloud_chart(1, offset=1, runner=run)

        self.assertEqual(scanned, 1)
        self.assertEqual(len(tracks), 1)
        # 차트 한 번 + 구간 안의 곡 한 번. 전체 차트를 곡별로 조회하면 낭비다.
        self.assertEqual(len(calls), 2)

    def test_a_broken_track_does_not_lose_the_batch(self):
        tracks, scanned = fetch_soundcloud_chart(3, runner=runner_sequence([
            self.CHART,
            OSError('삭제된 곡'),
            {'title': '히트곡', 'duration': 210, 'uploader': 'B',
             'webpage_url': 'https://soundcloud.com/b/hit'},
            {'title': '', 'duration': 200, 'uploader': 'C'},
        ]))

        self.assertEqual([track['title'] for track in tracks], ['히트곡'])
        self.assertEqual(scanned, 3)

    def test_partial_window_signals_the_end_of_the_chart(self):
        """요청보다 적게 훑으면 서버가 커서를 0으로 되돌린다. 그 신호가 scanned다."""
        tracks, scanned = fetch_soundcloud_chart(5, offset=1, runner=runner_sequence([
            self.CHART,
            {'title': '히트곡', 'duration': 210, 'uploader': 'B',
             'webpage_url': 'https://soundcloud.com/b/hit'},
            {'title': '조용한 곡', 'duration': 200, 'uploader': 'C',
             'webpage_url': 'https://soundcloud.com/c/quiet'},
        ]))

        self.assertEqual(len(tracks), 2)
        self.assertLess(scanned, 5)

    def test_offset_past_the_end_scans_nothing(self):
        tracks, scanned = fetch_soundcloud_chart(5, offset=99, runner=runner_sequence([self.CHART]))

        self.assertEqual((tracks, scanned), ([], 0))

    def test_empty_chart_is_not_an_error(self):
        tracks, scanned = fetch_soundcloud_chart(5, runner=runner_sequence([{'entries': []}]))

        self.assertEqual((tracks, scanned), ([], 0))

class CollectTest(unittest.TestCase):
    def test_offset_moves_the_window(self):
        chart = [{'artist': str(i), 'title': str(i), 'released_at': None} for i in range(10)]
        with patch.object(discover, 'fetch_apple_chart', return_value=chart), \
             patch.object(discover, 'find_youtube_id', side_effect=lambda a, t, r: f'id{a}'.ljust(11, 'x')):
            first, scanned_first = collect('apple_kr', None, 3, offset=0)
            second, scanned_second = collect('apple_kr', None, 3, offset=3)

        self.assertEqual([t['title'] for t in first], ['0', '1', '2'])
        self.assertEqual([t['title'] for t in second], ['3', '4', '5'], '다음 요청은 다음 구간을 본다')
        self.assertEqual((scanned_first, scanned_second), (3, 3))

    def test_scanned_shrinks_at_the_end_of_the_source(self):
        # scanned < limit이면 서버가 다음 요청을 처음부터 다시 시작한다.
        chart = [{'artist': str(i), 'title': str(i), 'released_at': None} for i in range(5)]
        with patch.object(discover, 'fetch_apple_chart', return_value=chart), \
             patch.object(discover, 'find_youtube_id', return_value='aaaaaaaaaaa'):
            _, scanned = collect('apple_kr', None, 10, offset=3)

        self.assertEqual(scanned, 2)

    def test_apple_source_resolves_each_track(self):
        with patch.object(discover, 'fetch_apple_chart', return_value=[
                {'artist': 'A', 'title': 'One', 'released_at': '2026-09-01'},
                {'artist': 'B', 'title': 'Two', 'released_at': '2026-09-02'}]), \
             patch.object(discover, 'find_youtube_id', side_effect=['aaaaaaaaaaa', None]):
            tracks, scanned = collect('apple_kr', None, 10)

        # 매칭에 실패한 곡은 조용히 빠진다. 큐에 넣을 수 없으니 실패로 볼 이유가 없다.
        self.assertEqual(len(tracks), 1)
        self.assertEqual(scanned, 2, '훑은 개수는 매칭 성공 여부와 별개다')
        self.assertEqual(tracks[0], {'platform': 'youtube', 'track_key': 'aaaaaaaaaaa',
                                     'title': 'One', 'artist_name': 'A'})

    def test_stops_at_the_requested_limit(self):
        with patch.object(discover, 'fetch_apple_chart', return_value=[
                {'artist': str(i), 'title': str(i), 'released_at': None} for i in range(10)]), \
             patch.object(discover, 'find_youtube_id', return_value='aaaaaaaaaaa'):
            self.assertEqual(len(collect('apple_kr', None, 3)[0]), 3)

    def test_unknown_source_is_rejected(self):
        with self.assertRaisesRegex(DiscoveryError, '^SOURCE_UNSUPPORTED$'):
            collect('spotify', None, 5)


if __name__ == '__main__':
    unittest.main()


MB = {'recordings': [
    {'title': 'Flame', 'artist-credit': [{'name': 'PLAVE'}], 'length': 187000},
    {'title': '그대라면 (inst.)', 'artist-credit': [{'name': '범진'}], 'length': 251000},
    {'title': '그대라면', 'artist-credit': [{'name': '범진'}], 'length': 251000},
    {'title': '그대라면', 'artist-credit': [{'name': '범진'}], 'length': 251000},
    {'title': '오아시스', 'artist-credit': [{'name': '정동하'}], 'length': None},
]}


class MusicBrainzTest(unittest.TestCase):
    def rows(self):
        from discover import fetch_musicbrainz_kr
        return fetch_musicbrainz_kr({'from': '2026-09-03', 'to': '2026-09-10'}, opener_for(MB))['rows']

    def test_drops_instrumentals_and_duplicates(self):
        rows = self.rows()

        self.assertEqual([r['title'] for r in rows], ['Flame', '그대라면', '오아시스'])

    def test_carries_expected_length_for_verification(self):
        rows = self.rows()

        self.assertEqual(rows[0]['expected_sec'], 187)
        self.assertIsNone(rows[2]['expected_sec'], '길이를 모르는 곡도 버리지 않는다')

    def test_fetch_failure_is_reported(self):
        from discover import fetch_musicbrainz_kr
        def broken(*_a, **_k):
            raise OSError('down')
        with self.assertRaisesRegex(DiscoveryError, '^SOURCE_FETCH_FAILED$'):
            fetch_musicbrainz_kr({'from': 'a', 'to': 'b'}, broken)


class DurationVerificationTest(unittest.TestCase):
    """MusicBrainz가 주는 곡 길이로 동명이인·풀앨범을 거른다."""

    def test_rejects_results_far_from_the_expected_length(self):
        # 실측: 'Giant' 검색이 1972년 동명이인 곡(2281초)을 물어왔다.
        payload = {'entries': [{'id': 'aaaaaaaaaaa', 'duration': 2281},
                               {'id': 'bbbbbbbbbbb', 'duration': 240}]}

        self.assertEqual(find_youtube_id('Giant', 'x', runner_for(payload), expected_sec=240),
                         'bbbbbbbbbbb')

    def test_accepts_small_differences(self):
        payload = {'entries': [{'id': 'abcdefghijk', 'duration': 283}]}

        self.assertEqual(find_youtube_id('전건호', '병원에 가다', runner_for(payload), expected_sec=281),
                         'abcdefghijk')

    def test_no_expected_length_means_no_duration_check(self):
        payload = {'entries': [{'id': 'abcdefghijk', 'duration': 500}]}

        self.assertEqual(find_youtube_id('a', 'b', runner_for(payload)), 'abcdefghijk')


class MusicBrainzCollectTest(unittest.TestCase):
    def test_uses_the_given_window(self):
        with patch.object(discover, 'fetch_musicbrainz_kr', return_value={'rows': [
                {'artist': 'A', 'title': 'One', 'expected_sec': 200}], 'scanned': 1}) as fetch, \
             patch.object(discover, 'find_youtube_id', return_value='aaaaaaaaaaa'):
            tracks, scanned = collect('musicbrainz_kr', None, 10,
                                      window={'from': '2026-09-03', 'to': '2026-09-10'})

        self.assertEqual(fetch.call_args[0][0], {'from': '2026-09-03', 'to': '2026-09-10'})
        self.assertEqual(len(tracks), 1)
        self.assertEqual(scanned, 1, '원본 페이지에서 실제로 읽은 개수를 보고한다')

    def test_no_window_means_backfill_is_finished(self):
        # 서버가 백필 하한에 닿으면 창을 주지 않는다.
        self.assertEqual(collect('musicbrainz_kr', None, 10, window=None), ([], 0))


class MusicBrainzPaginationTest(unittest.TestCase):
    def test_page_offset_and_raw_count_include_filtered_rows(self):
        import urllib.parse
        from discover import fetch_musicbrainz_kr
        seen = []
        def opener(request, **kwargs):
            seen.append(urllib.parse.parse_qs(urllib.parse.urlparse(request.full_url).query))
            return opener_for(MB)(request, **kwargs)
        page = fetch_musicbrainz_kr({'from': '2026-09-01', 'to': '2026-09-08'}, opener, offset=20, limit=20)
        self.assertEqual(seen[0]['offset'], ['20'])
        self.assertEqual(seen[0]['limit'], ['20'])
        self.assertEqual(page['scanned'], len(MB['recordings']))
        self.assertLess(len(page['rows']), page['scanned'])
