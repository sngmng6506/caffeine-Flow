import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import discover
from discover import DiscoveryError, collect, fetch_apple_chart, find_youtube_id, search_soundcloud


def runner_for(payload):
    return lambda *a, **k: SimpleNamespace(stdout=json.dumps(payload).encode())


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


class SoundcloudSearchTest(unittest.TestCase):
    """차트가 아니라 검색을 쓰는 이유는 지역 신을 겨냥하기 때문이다. 인기 차트에는
    인디가 거의 안 잡힌다."""

    def entries(self):
        return {'entries': [
            {'url': 'https://soundcloud.com/a/mix', 'duration': 3510, 'view_count': 90000,
             'title': '3시간 DJ 믹스', 'uploader': 'A'},
            {'url': 'https://soundcloud.com/b/quiet', 'duration': 200, 'view_count': 30,
             'title': '조용한 곡', 'uploader': 'B'},
            {'url': 'https://soundcloud.com/c/hit', 'duration': 210, 'view_count': 3410,
             'title': '히트곡', 'uploader': 'C'},
        ]}

    def test_drops_long_mixes_and_sorts_by_plays(self):
        tracks = search_soundcloud('korean indie', 5, runner_for(self.entries()))

        self.assertEqual([track['title'] for track in tracks], ['히트곡', '조용한 곡'])
        self.assertEqual(tracks[0]['platform'], 'soundcloud')
        self.assertEqual(tracks[0]['track_key'], 'https://soundcloud.com/c/hit')

    def test_honours_the_requested_limit(self):
        self.assertEqual(len(search_soundcloud('korean indie', 1, runner_for(self.entries()))), 1)

    def test_offset_moves_the_window(self):
        first, scanned = collect('soundcloud', 'korean indie', 1, 0, runner=runner_for(self.entries()))
        second, _ = collect('soundcloud', 'korean indie', 1, 1, runner=runner_for(self.entries()))

        self.assertEqual(scanned, 1)
        self.assertNotEqual(first[0]['track_key'], second[0]['track_key'])

    def test_scanned_shrinks_at_the_end_of_the_source(self):
        """검색이 주는 결과에 한계가 있어 깊이 들어가면 구간이 짧아진다. 그게 끝 신호다."""
        window, scanned = collect('soundcloud', 'korean indie', 5, 1, runner=runner_for(self.entries()))

        self.assertEqual(len(window), 1)
        self.assertLess(scanned, 5)


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
