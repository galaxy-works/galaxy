import tempfile
from typing import (
    Any,
    cast,
)

import pytest

from galaxy.datatypes.tabular import (
    CSV,
    MAX_DATA_LINES,
    Tabular,
    TSV,
)
from .util import MockDataset


@pytest.mark.parametrize(
    "datatype, content, value",
    [
        (CSV(), 'name,count,score\n"alpha, one",1,1.5\n"say ""hi""",2,2.5\nbeta,,3.5\n', "alpha, one"),
        (TSV(), 'name\tcount\tscore\n"alpha\tone"\t1\t1.5\n"say ""hi"""\t2\t2.5\nbeta\t\t3.5\n', "alpha\tone"),
    ],
    ids=["csv", "tsv"],
)
def test_delimited_dataprovider_parses_quoted_values(tmp_path, datatype, content, value):
    source = tmp_path / f"input.{datatype.file_ext}"
    source.write_text(content)
    dataset = MockDataset(id=1)
    dataset.set_file_name(str(source))
    cast(Any, dataset).datatype = datatype
    datatype.set_meta(dataset)
    rows = list(datatype.dataset_column_dataprovider(dataset, indeces=[0, 1, 2]))
    assert rows[1:] == [[value, 1, 1.5], ['say "hi"', 2, 2.5], ["beta", None, 3.5]]


def test_tabular_dataprovider_ignores_quotes(tmp_path):
    source = tmp_path / "input.tabular"
    source.write_text('"alpha\tone"\t1\n')
    datatype = Tabular()
    dataset = MockDataset(id=1)
    dataset.set_file_name(str(source))
    cast(Any, dataset).datatype = datatype
    datatype.set_meta(dataset)  # type: ignore [arg-type]
    rows = list(datatype.dataset_column_dataprovider(dataset, indeces=[0, 1]))  # type: ignore [arg-type]
    assert rows == [['"alpha', 'one"']]


def test_tabular_set_meta_large_file():
    with tempfile.NamedTemporaryFile(mode="w") as test_file:
        for _ in range(MAX_DATA_LINES + 1):
            test_file.write("A\tB\n")
        test_file.flush()
        dataset = MockDataset(id=1)
        dataset.set_file_name(test_file.name)
        Tabular().set_meta(dataset)  # type: ignore [arg-type]
        # data and comment lines are not stored if more than MAX_DATA_LINES
        assert dataset.metadata.data_lines is None
        assert dataset.metadata.comment_lines is None
        assert dataset.metadata.column_types == ["str", "str"]
        assert dataset.metadata.columns == 2
        assert dataset.metadata.delimiter == "\t"
        assert not hasattr(dataset.metadata, "column_names")


def test_tabular_set_meta_empty():
    """
    empty file
    """
    with tempfile.NamedTemporaryFile(mode="w") as test_file:
        test_file.flush()
        dataset = MockDataset(id=1)
        dataset.set_file_name(test_file.name)
        Tabular().set_meta(dataset)  # type: ignore [arg-type]
        # data and comment lines are not stored if more than MAX_DATA_LINES
        assert dataset.metadata.data_lines == 0
        assert dataset.metadata.comment_lines == 0
        assert dataset.metadata.column_types == []
        assert dataset.metadata.columns == 0
        assert dataset.metadata.delimiter == "\t"
        assert not hasattr(dataset.metadata, "column_names")


def test_tabular_set_meta_nearly_empty():
    """
    file just containing a single new line
    - empty lines are treated as comments
    """
    with tempfile.NamedTemporaryFile(mode="w") as test_file:
        test_file.write("\n")
        test_file.flush()
        dataset = MockDataset(id=1)
        dataset.set_file_name(test_file.name)
        Tabular().set_meta(dataset)  # type: ignore [arg-type]
        # data and comment lines are not stored if more than MAX_DATA_LINES
        assert dataset.metadata.data_lines == 0
        assert dataset.metadata.comment_lines == 1
        assert dataset.metadata.column_types == []
        assert dataset.metadata.columns == 0
        assert dataset.metadata.delimiter == "\t"
        assert not hasattr(dataset.metadata, "column_names")


def test_tabular_column_types():
    """
    file containing a single containing only tab characters terminated with a new line character
    - empty lines are treated as comments
    """
    with tempfile.NamedTemporaryFile(mode="w") as test_file:
        # 1st line has special treatment which we want to ignore in this test
        test_file.write("\t\t\t\t\n")
        # note that the 1st column of this line will be detected as None
        # but this is overwritten by the default column type (str) after
        # checking all lines
        test_file.write("\tstr\t23\t42.00\ta,b,c\n")
        test_file.flush()
        dataset = MockDataset(id=1)
        dataset.set_file_name(test_file.name)
        Tabular().set_meta(dataset)  # type: ignore [arg-type]
        # data and comment lines are not stored if more than MAX_DATA_LINES
        assert dataset.metadata.data_lines == 2
        assert dataset.metadata.comment_lines == 0
        assert dataset.metadata.column_types == ["str", "str", "int", "float", "list"]
        assert dataset.metadata.columns == 5
        assert dataset.metadata.delimiter == "\t"
        assert not hasattr(dataset.metadata, "column_names")


def test_tabular_column_types_override():
    """
    check that guessed column types can be improved
    by the types guessed for later lines
    overwriting is only possible in the following order None -> int -> float -> list -> str

    also check that more columns can be added by later lines
    """
    with tempfile.NamedTemporaryFile(mode="w") as test_file:
        # 1st line has special treatment which we want to ignore in this test
        test_file.write("\t\t\t\t\n")
        # note that the first column in detected as None which can be overwritten by int
        test_file.write("\t23\t42.00\ta,b,c\tstr\n")
        test_file.write("23\t42.0\t23,42.0\tstr\t42\tanother column\n")
        test_file.flush()
        dataset = MockDataset(id=1)
        dataset.set_file_name(test_file.name)
        Tabular().set_meta(dataset)  # type: ignore [arg-type]
        # data and comment lines are not stored if more than MAX_DATA_LINES
        assert dataset.metadata.data_lines == 3
        assert dataset.metadata.comment_lines == 0
        assert dataset.metadata.column_types == ["int", "float", "list", "str", "str", "str"]
        assert dataset.metadata.columns == 6
        assert dataset.metadata.delimiter == "\t"
        assert not hasattr(dataset.metadata, "column_names")


def test_tabular_display_peek_does_not_render_table_header():
    dataset = MockDataset(id=1)
    dataset_for_peek = cast(Any, dataset)
    metadata = cast(Any, dataset.metadata)
    dataset_for_peek.peek = "question_id\tcurator_name\nensembl-grab-q1\tLG\n"
    metadata.columns = 2
    metadata.delimiter = "\t"

    html = Tabular().display_peek(dataset)  # type: ignore [arg-type]

    assert "<th>" not in html
    assert "<td>question_id</td>" in html
    assert "<td>curator_name</td>" in html


def test_csv_set_meta_strips_byte_order_mark():
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8-sig") as test_file:
        test_file.write("GeneName,A1\nGene1,5\n")
        test_file.flush()
        dataset = MockDataset(id=1)
        dataset.set_file_name(test_file.name)
        CSV().set_meta(dataset)  # type: ignore [arg-type]
        assert dataset.metadata.column_names == ["GeneName", "A1"]
        assert dataset.metadata.column_types == ["str", "int"]
