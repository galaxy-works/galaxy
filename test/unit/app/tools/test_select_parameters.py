from unittest.mock import Mock

import pytest

from galaxy import model
from galaxy.tools.parameters.options import ParameterOption
from galaxy.tools.parameters.workflow_utils import (
    ConnectedValue,
    RuntimeValue,
)
from .util import BaseParameterTestCase

FROM_DATASET_OPTIONS = (
    """<options from_dataset="input_bam"><column name="name" index="0"/><column name="value" index="0"/></options>"""
)


class TestSelectToolParameter(BaseParameterTestCase):
    def new_hda(self):
        hda = model.HistoryDatasetAssociation()
        hda._state = model.Dataset.states.OK
        return hda

    def test_validated_values(self):
        self.options_xml = """<options><filter type="data_meta" ref="input_bam" key="dbkey"/></options>"""
        with pytest.raises(ValueError) as exc_info:
            self.param.from_json("42", self.trans, {"input_bam": self.new_hda()})
        assert str(exc_info.value) == "Parameter 'my_name': requires a value, but no legal values defined"

    def test_validated_values_missing_dependency(self):
        self.options_xml = """<options><filter type="data_meta" ref="input_bam" key="dbkey"/></options>"""
        with pytest.raises(ValueError) as exc_info:
            self.param.from_json("42", self.trans)
        assert str(exc_info.value) == "Parameter 'my_name': requires a value, but no legal values defined"

    def test_dict_value_is_invalid_option(self):
        # A dict value is unhashable; checking it against the set of legal
        # values used to raise an opaque "unhashable type: 'dict'" TypeError.
        param = self._parameter_for(xml="""<param name="my_name" type="select"><option value="a">A</option></param>""")
        with pytest.raises(ValueError) as exc_info:
            param.from_json({"not": "valid"}, self.trans)
        assert "an invalid option" in str(exc_info.value)

    def test_unvalidated_values(self):
        self.options_xml = """<options><filter type="data_meta" ref="input_bam" key="dbkey"/></options>"""
        self.trans.workflow_building_mode = True
        assert self.param.from_json("42", self.trans) == "42"

    def test_get_initial_value_without_trans(self):
        # conditional case inference calls this with no transaction
        param = self._parameter_for(
            xml="""<param name="my_name" type="select"><option value="a">A</option><option value="b" selected="true">B</option></param>"""
        )
        assert param.get_initial_value(None, {}) == "b"

    def test_validated_datasets(self):
        self.options_xml = """<options><filter type="data_meta" ref="input_bam" key="dbkey"/></options>"""
        with pytest.raises(ValueError) as exc_info:
            self.param.from_json(self.new_hda(), self.trans, {"input_bam": None})
        assert str(exc_info.value) == "Parameter 'my_name': requires a value, but no legal values defined"

    def test_unvalidated_datasets(self):
        self.options_xml = """<options><filter type="data_meta" ref="input_bam" key="dbkey"/></options>"""
        self.trans.workflow_building_mode = True
        assert isinstance(
            self.param.from_json(self.new_hda(), self.trans, {"input_bam": RuntimeValue()}),
            model.HistoryDatasetAssociation,
        )

    def test_filter_param_value(self):
        self.options_xml = """<options from_data_table="test_table"><filter type="param_value" ref="input_bam" column="0" /></options>"""
        assert ParameterOption("testname1", "testpath1", False) in self.param.get_options(
            self.trans, {"input_bam": "testname1"}
        )
        assert ParameterOption("testname2", "testpath2", False) in self.param.get_options(
            self.trans, {"input_bam": "testname2"}
        )
        assert len(self.param.get_options(self.trans, {"input_bam": "testname3"})) == 0

    def test_filter_param_value2(self):
        # Same test as above, but filtering on a different column.
        self.options_xml = """<options from_data_table="test_table"><filter type="param_value" ref="input_bam" column="1" /></options>"""
        assert ParameterOption("testname1", "testpath1", False) in self.param.get_options(
            self.trans, {"input_bam": "testpath1"}
        )
        assert ParameterOption("testname2", "testpath2", False) in self.param.get_options(
            self.trans, {"input_bam": "testpath2"}
        )
        assert len(self.param.get_options(self.trans, {"input_bam": "testpath3"})) == 0

    def test_to_dict_static_select_has_no_unavailable_reason(self):
        param = self._parameter_for(xml="""<param name="my_name" type="select"><option value="a">A</option></param>""")
        as_dict = param.to_dict(self.trans, {})
        assert "options_unavailable" not in as_dict
        assert "data_ref" not in as_dict

    def test_to_dict_from_dataset_emits_data_ref(self):
        self.options_xml = FROM_DATASET_OPTIONS
        assert self.param.to_dict(self.trans, {"input_bam": RuntimeValue()})["data_ref"] == "input_bam"

    def test_options_unavailable_data_ref_runtime(self):
        self.options_xml = FROM_DATASET_OPTIONS
        for value in [RuntimeValue(), ConnectedValue(), {"__class__": "ConnectedValue"}]:
            as_dict = self.param.to_dict(self.trans, {"input_bam": value})
            assert as_dict["options"] == []
            assert as_dict["options_unavailable"] == {"reason": "data_ref_runtime", "data_ref": "input_bam"}

    def test_options_unavailable_data_ref_not_ready(self):
        self.options_xml = FROM_DATASET_OPTIONS
        hda = self.new_hda()
        hda._state = model.Dataset.states.QUEUED
        as_dict = self.param.to_dict(self.trans, {"input_bam": hda})
        assert as_dict["options_unavailable"] == {"reason": "data_ref_not_ready", "data_ref": "input_bam"}
        assert as_dict["textable"] is True

    def test_options_unavailable_data_ref_missing(self):
        self.options_xml = FROM_DATASET_OPTIONS
        for other_values in [{}, {"input_bam": None}, {"input_bam": []}]:
            as_dict = self.param.to_dict(self.trans, other_values)
            assert as_dict["options_unavailable"] == {"reason": "data_ref_missing", "data_ref": "input_bam"}

    def test_options_unavailable_no_options(self):
        # A ready dataset that yields no rows (here, one without a file) resolves to nothing.
        self.options_xml = FROM_DATASET_OPTIONS
        as_dict = self.param.to_dict(self.trans, {"input_bam": self.new_hda()})
        assert as_dict["options_unavailable"] == {"reason": "no_options", "data_ref": "input_bam"}
        assert as_dict["textable"] is False

    def test_options_unavailable_no_options_without_data_ref(self):
        self.options_xml = """<options from_data_table="test_table"><filter type="param_value" ref="input_bam" column="0" /></options>"""
        as_dict = self.param.to_dict(self.trans, {"input_bam": "testname3"})
        assert as_dict["options_unavailable"] == {"reason": "no_options", "data_ref": None}

    def test_options_unavailable_data_meta_filter_ref(self):
        self.options_xml = """<options from_data_table="test_table"><filter type="data_meta" ref="input_bam" key="dbkey" column="0"/></options>"""
        hda = self.new_hda()
        hda.dbkey = "hg19"
        as_dict = self.param.to_dict(self.trans, {"input_bam": hda})
        assert as_dict["options"] == []
        assert as_dict["options_unavailable"] == {"reason": "no_options", "data_ref": "input_bam"}
        hda._state = model.Dataset.states.QUEUED
        as_dict = self.param.to_dict(self.trans, {"input_bam": hda})
        assert as_dict["options_unavailable"] == {"reason": "data_ref_not_ready", "data_ref": "input_bam"}

    def test_options_available_has_no_unavailable_reason(self):
        self.options_xml = """<options from_data_table="test_table"/>"""
        as_dict = self.param.to_dict(self.trans, {})
        assert len(as_dict["options"]) == 2
        assert "options_unavailable" not in as_dict

    def test_group_tag_options_unavailable(self):
        self.type = "group_tag"
        self.set_data_ref = True
        as_dict = self.param.to_dict(self.trans, {"input_bam": ConnectedValue()})
        assert as_dict["data_ref"] == "input_bam"
        assert as_dict["options_unavailable"] == {"reason": "data_ref_runtime", "data_ref": "input_bam"}
        as_dict = self.param.to_dict(self.trans, {"input_bam": self.new_hda()})
        assert as_dict["options_unavailable"] == {"reason": "no_options", "data_ref": "input_bam"}

    # TODO: Good deal of overlap here with TestDataToolParameter, refactor.
    def setUp(self):
        super().setUp()
        self.test_history = model.History()
        session = self.app.model.context
        session.add(self.test_history)
        session.commit()
        self.app.tool_data_tables["test_table"] = MockToolDataTable()
        self.trans = Mock(
            app=self.app,
            get_history=lambda: self.test_history,
            get_current_user_roles=lambda: [],
            workflow_building_mode=False,
            webapp=Mock(name="galaxy"),
            user=None,
        )
        self.type = "select"
        self.set_data_ref = False
        self.multiple = False
        self.optional = False
        self.options_xml = ""
        self._param = None

    @property
    def param(self):
        if not self._param:
            multi_text = ""
            if self.multiple:
                multi_text = 'multiple="True"'
            optional_text = ""
            if self.optional:
                optional_text = 'optional="True"'
            options_text = self.options_xml
            data_ref_text = ""
            if self.set_data_ref:
                data_ref_text = 'data_ref="input_bam"'
            param_str = f"""<param name="my_name" type="{self.type}" {data_ref_text} {multi_text} {optional_text}>{options_text}</param>"""
            self._param = self._parameter_for(xml=param_str)

        return self._param


class MockToolDataTable:
    def __init__(self):
        self.columns = dict(
            name=0,
            value=1,
        )
        self.missing_index_file = None

    def get_fields(self):
        return [["testname1", "testpath1"], ["testname2", "testpath2"]]
